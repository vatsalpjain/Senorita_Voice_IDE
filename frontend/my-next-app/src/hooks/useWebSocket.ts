"use client";

import { useState, useEffect, useRef, useCallback } from "react";

/* ============================================================
   useWebSocket — Persistent WS connection with auto-reconnect
   ============================================================
   Manages: connect, exponential-backoff reconnect, send, close.
   Used by VoicePanel for the persistent /ws/voice connection.
   ============================================================ */

export type WSStatus = "connecting" | "connected" | "disconnected" | "error";

export interface WSMessage {
  type: string;
  [key: string]: unknown;
}

export interface UseWebSocketOptions {
  url: string;
  /** Auto-connect on mount (default: true) */
  autoConnect?: boolean;
  /** Max reconnect attempts before giving up (default: 8) */
  maxReconnectAttempts?: number;
  /** Called for every parsed JSON message */
  onMessage?: (msg: WSMessage) => void;
  /** Called when binary data is received */
  onBinary?: (data: ArrayBuffer) => void;
  /** Called when connection opens */
  onOpen?: () => void;
  /** Called when connection closes */
  onClose?: () => void;
  /** Called on error */
  onError?: (error: Event) => void;
}

export interface UseWebSocketReturn {
  status: WSStatus;
  isConnected: boolean;
  send: (data: string | object) => void;
  connect: () => void;
  disconnect: () => void;
  error: string | null;
}

export function useWebSocket(options: UseWebSocketOptions): UseWebSocketReturn {
  const {
    url,
    autoConnect = true,
    maxReconnectAttempts = 8,
    onMessage,
    onBinary,
    onOpen,
    onClose,
    onError,
  } = options;

  const [status, setStatus] = useState<WSStatus>("disconnected");
  const [error, setError]   = useState<string | null>(null);

  const wsRef            = useRef<WebSocket | null>(null);
  const reconnectCount   = useRef(0);
  const reconnectTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intentionalClose = useRef(false);

  // Store latest callbacks in refs to avoid re-creating the socket on every render
  const cbRefs = useRef({ onMessage, onBinary, onOpen, onClose, onError });
  cbRefs.current = { onMessage, onBinary, onOpen, onClose, onError };

  /* ── Connect ───────────────────────────────────────────── */
  const connect = useCallback(() => {
    // Clean up any existing socket
    if (wsRef.current) {
      intentionalClose.current = true;
      wsRef.current.close();
    }

    intentionalClose.current = false;
    setStatus("connecting");
    setError(null);

    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onopen = () => {
      // Don't set 'connected' yet — wait for the backend's { type: "connected" } ack
      // This prevents false-positive connected states before the handshake completes
      reconnectCount.current = 0;
      cbRefs.current.onOpen?.();
    };

    ws.onmessage = (event: MessageEvent) => {
      if (event.data instanceof ArrayBuffer) {
        cbRefs.current.onBinary?.(event.data);
        return;
      }
      try {
        const msg = JSON.parse(event.data as string) as WSMessage;
        // Backend sends { type: "connected" } as first message — use it as ready signal
        if (msg.type === "connected" && status !== "connected") {
          setStatus("connected");
          setError(null);
        }
        cbRefs.current.onMessage?.(msg);
      } catch {
        /* non-JSON text — ignore */
      }
    };

    ws.onerror = (evt) => {
      setStatus("error");
      setError("WebSocket connection error");
      cbRefs.current.onError?.(evt);
    };

    ws.onclose = () => {
      setStatus("disconnected");
      cbRefs.current.onClose?.();

      // Auto-reconnect unless deliberately closed
      if (!intentionalClose.current && reconnectCount.current < maxReconnectAttempts) {
        // Min 2s delay to avoid reconnect spam during HMR
        const delay = Math.max(2000, Math.min(1000 * 2 ** reconnectCount.current, 30_000));
        reconnectCount.current += 1;
        reconnectTimer.current = setTimeout(() => connect(), delay);
      }
    };
  }, [url, maxReconnectAttempts]);

  /* ── Disconnect ────────────────────────────────────────── */
  const disconnect = useCallback(() => {
    intentionalClose.current = true;
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
    wsRef.current?.close();
    setStatus("disconnected");
  }, []);

  /* ── Send ──────────────────────────────────────────────── */
  const send = useCallback((data: string | object) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.warn("[useWebSocket] Cannot send — socket not open");
      return;
    }
    const payload = typeof data === "string" ? data : JSON.stringify(data);
    wsRef.current.send(payload);
  }, []);

  /* ── Auto-connect on mount (debounced to survive React Strict Mode) ── */
  useEffect(() => {
    if (!autoConnect) return;

    // Delay connect by 500ms — React Strict Mode unmounts after ~100ms,
    // so the timer gets cleared before the first socket ever opens.
    const timer = setTimeout(() => connect(), 500);
    return () => {
      clearTimeout(timer);
      disconnect();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    status,
    isConnected: status === "connected",
    send,
    connect,
    disconnect,
    error,
  };
}
