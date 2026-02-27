"use client";

import { useState, useEffect, useRef, useCallback } from "react";

/* ============================================================
   TYPES
   ============================================================ */
export type WakeWordStatus =
  | "idle"
  | "connecting"
  | "listening"
  | "detected"
  | "paused"
  | "error"
  | "unavailable";

export interface WakeWordState {
  status: WakeWordStatus;
  isAvailable: boolean;
  confidence: number;
  error: string | null;
}

export interface UseWakeWordOptions {
  enabled?: boolean;
  threshold?: number;
  onDetected?: (confidence: number) => void;
  onError?: (error: string) => void;
  wsUrl?: string;
}

export interface UseWakeWordReturn extends WakeWordState {
  start: () => void;
  stop: () => void;
  pause: () => void;
  resume: () => void;
  setEnabled: (enabled: boolean) => void;
}

/* ============================================================
   CONSTANTS
   ============================================================ */
const DEFAULT_WS_URL =
  typeof window !== "undefined"
    ? (process.env.NEXT_PUBLIC_WS_URL?.replace("/ws/voice", "/ws/wake-word") ??
      "ws://localhost:8000/ws/wake-word")
    : "ws://localhost:8000/ws/wake-word";

const RECONNECT_DELAY_MS = 3000;
const MAX_RECONNECTS = 5;

// Audio settings - must match backend
const SAMPLE_RATE = 16000;
const CHUNK_DURATION_MS = 100; // Send 100ms chunks
const CHUNK_SAMPLES = Math.floor(SAMPLE_RATE * (CHUNK_DURATION_MS / 1000));

/* ============================================================
   HOOK
   ============================================================ */
export function useWakeWord(options: UseWakeWordOptions = {}): UseWakeWordReturn {
  const {
    enabled: initialEnabled = false,
    threshold = 0.5,
    onDetected,
    onError,
    wsUrl = DEFAULT_WS_URL,
  } = options;

  const [state, setState] = useState<WakeWordState>({
    status: "idle",
    isAvailable: false,
    confidence: 0,
    error: null,
  });

  // Use the prop directly instead of internal state
  // This ensures the hook responds to prop changes from parent
  const enabled = initialEnabled;

  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const reconnectCount = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const connectRef = useRef<() => void>(() => {});

  /* ----------------------------------------------------------
     Connect to WebSocket
     ---------------------------------------------------------- */
  const connect = useCallback(() => {
    if (typeof window === "undefined") return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      if (mountedRef.current) {
        setState((prev) => ({ ...prev, status: "connecting", error: null }));
      }

      ws.onopen = () => {
        if (!mountedRef.current) return;
        reconnectCount.current = 0;
        console.log("[WakeWord] WebSocket connected, configuring threshold:", threshold);
        // Configure threshold
        ws.send(JSON.stringify({ type: "configure", threshold, debug: true }));
      };

      ws.onmessage = (ev) => {
        if (!mountedRef.current) return;
        try {
          const msg = JSON.parse(ev.data);

          switch (msg.type) {
            case "connected":
              console.log("[WakeWord] Server connected, available:", msg.available);
              setState((prev) => ({
                ...prev,
                status: msg.available ? "listening" : "unavailable",
                isAvailable: msg.available,
                error: msg.available ? null : "Wake word model not available",
              }));
              break;

            case "wake_word_detected":
              console.log("[WakeWord] 🎤 DETECTED! Confidence:", msg.confidence);
              setState((prev) => ({
                ...prev,
                status: "detected",
                confidence: msg.confidence,
              }));
              onDetected?.(msg.confidence);
              break;

            case "probability":
              // Debug mode - update confidence without triggering
              if (msg.value > 0.1) {
                console.log("[WakeWord] Probability:", msg.value);
              }
              setState((prev) => ({ ...prev, confidence: msg.value }));
              break;

            case "paused":
              setState((prev) => ({ ...prev, status: "paused" }));
              break;

            case "resumed":
              setState((prev) => ({ ...prev, status: "listening" }));
              break;

            case "error":
              setState((prev) => ({ ...prev, status: "error", error: msg.message }));
              onError?.(msg.message);
              break;
          }
        } catch {
          // Ignore parse errors
        }
      };

      ws.onerror = () => {
        if (!mountedRef.current) return;
        setState((prev) => ({ ...prev, status: "error", error: "WebSocket error" }));
      };

      ws.onclose = () => {
        if (!mountedRef.current) return;
        wsRef.current = null;

        // Attempt reconnect if still enabled
        if (enabled && reconnectCount.current < MAX_RECONNECTS) {
          reconnectCount.current += 1;
          setState((prev) => ({ ...prev, status: "connecting" }));
          reconnectTimer.current = setTimeout(() => connectRef.current(), RECONNECT_DELAY_MS);
        } else {
          setState((prev) => ({ ...prev, status: "idle" }));
        }
      };
    } catch (err) {
      if (mountedRef.current) {
        const msg = err instanceof Error ? err.message : "Connection failed";
        setState((prev) => ({ ...prev, status: "error", error: msg }));
      }
    }
  }, [wsUrl, threshold, enabled, onDetected, onError]);

  // Keep connectRef updated (in effect to satisfy lint)
  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  /* ----------------------------------------------------------
     Start audio capture and streaming
     ---------------------------------------------------------- */
  const startAudioCapture = useCallback(async () => {
    try {
      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: SAMPLE_RATE,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      streamRef.current = stream;

      // Create AudioContext
      const audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
      audioContextRef.current = audioContext;

      // Create source from microphone
      const source = audioContext.createMediaStreamSource(stream);

      // Use ScriptProcessorNode (deprecated but widely supported)
      // For production, consider AudioWorklet
      const bufferSize = 4096;
      const processor = audioContext.createScriptProcessor(bufferSize, 1, 1);

      let audioBuffer: Float32Array[] = [];
      let samplesCollected = 0;

      processor.onaudioprocess = (e) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

        const inputData = e.inputBuffer.getChannelData(0);
        audioBuffer.push(new Float32Array(inputData));
        samplesCollected += inputData.length;

        // Send when we have enough samples
        if (samplesCollected >= CHUNK_SAMPLES) {
          // Merge buffers
          const merged = new Float32Array(samplesCollected);
          let offset = 0;
          for (const buf of audioBuffer) {
            merged.set(buf, offset);
            offset += buf.length;
          }

          // Convert to 16-bit PCM
          const pcm = new Int16Array(merged.length);
          for (let i = 0; i < merged.length; i++) {
            const s = Math.max(-1, Math.min(1, merged[i]));
            pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
          }

          // Send to WebSocket
          wsRef.current.send(pcm.buffer);
          // console.log("[WakeWord] Sent", pcm.length, "samples");

          // Reset buffer
          audioBuffer = [];
          samplesCollected = 0;
        }
      };

      source.connect(processor);
      processor.connect(audioContext.destination);

      // Store reference for cleanup
      (audioContextRef.current as AudioContext & { _processor?: ScriptProcessorNode; _source?: MediaStreamAudioSourceNode })._processor = processor;
      (audioContextRef.current as AudioContext & { _processor?: ScriptProcessorNode; _source?: MediaStreamAudioSourceNode })._source = source;

    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to access microphone";
      setState((prev) => ({ ...prev, status: "error", error: msg }));
      onError?.(msg);
    }
  }, [onError]);

  /* ----------------------------------------------------------
     Stop audio capture
     ---------------------------------------------------------- */
  const stopAudioCapture = useCallback(() => {
    // Stop audio processing
    if (audioContextRef.current) {
      try {
        const ctx = audioContextRef.current as AudioContext & { _processor?: ScriptProcessorNode; _source?: MediaStreamAudioSourceNode };
        ctx._processor?.disconnect();
        ctx._source?.disconnect();
        audioContextRef.current.close();
      } catch {
        // Ignore errors during cleanup
      }
      audioContextRef.current = null;
    }

    // Stop media stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }, []);

  /* ----------------------------------------------------------
     Public controls
     ---------------------------------------------------------- */
  const startRef = useRef<() => void>(() => {});
  const stopRef = useRef<() => void>(() => {});

  // Update refs in effects to satisfy lint rules
  useEffect(() => {
    startRef.current = () => {
      connect();
      startAudioCapture();
    };
  }, [connect, startAudioCapture]);

  useEffect(() => {
    stopRef.current = () => {
      stopAudioCapture();
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }
      setState((prev) => ({ ...prev, status: "idle" }));
    };
  }, [stopAudioCapture]);

  const start = useCallback(() => startRef.current(), []);
  const stop = useCallback(() => stopRef.current(), []);

  const pause = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "pause" }));
    }
  }, []);

  const resume = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "resume" }));
    }
    // Reset status to listening after detection
    if (state.status === "detected") {
      setState((prev) => ({ ...prev, status: "listening", confidence: 0 }));
    }
  }, [state.status]);

  // setEnabled is a no-op since we use the prop directly
  // Parent component controls enabled state
  const setEnabled = useCallback((_value: boolean) => {
    // No-op - parent controls enabled via prop
  }, []);

  /* ----------------------------------------------------------
     Effect: Start/stop based on enabled state
     ---------------------------------------------------------- */
  useEffect(() => {
    console.log("[WakeWord] enabled changed:", enabled);
    if (enabled) {
      console.log("[WakeWord] Starting wake word detection...");
      // Connect to WebSocket
      if (typeof window !== "undefined" && (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN)) {
        console.log("[WakeWord] Creating WebSocket connection to:", wsUrl);
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;
        setState((prev) => ({ ...prev, status: "connecting", error: null }));

        ws.onopen = () => {
          console.log("[WakeWord] WebSocket opened, sending config");
          ws.send(JSON.stringify({ type: "configure", threshold, debug: true }));
        };

        ws.onmessage = (ev) => {
          try {
            const msg = JSON.parse(ev.data);
            console.log("[WakeWord] Received:", msg.type, msg);
            
            if (msg.type === "connected") {
              setState((prev) => ({
                ...prev,
                status: msg.available ? "listening" : "unavailable",
                isAvailable: msg.available,
              }));
            } else if (msg.type === "wake_word_detected") {
              console.log("[WakeWord] 🎤 DETECTED!", msg.confidence);
              setState((prev) => ({ ...prev, status: "detected", confidence: msg.confidence }));
              onDetected?.(msg.confidence);
            } else if (msg.type === "probability" && msg.value > 0.1) {
              console.log("[WakeWord] Probability:", msg.value);
              setState((prev) => ({ ...prev, confidence: msg.value }));
            }
          } catch { /* ignore */ }
        };

        ws.onerror = (e) => {
          console.error("[WakeWord] WebSocket error:", e);
          setState((prev) => ({ ...prev, status: "error", error: "WebSocket error" }));
        };

        ws.onclose = () => {
          console.log("[WakeWord] WebSocket closed");
          wsRef.current = null;
          setState((prev) => ({ ...prev, status: "idle" }));
        };
      }
      // Start audio capture
      startAudioCapture();
    } else {
      console.log("[WakeWord] Stopping wake word detection...");
      // Close WebSocket
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      stopAudioCapture();
      setState((prev) => ({ ...prev, status: "idle" }));
    }
  }, [enabled, wsUrl, threshold, onDetected, startAudioCapture, stopAudioCapture]);

  /* ----------------------------------------------------------
     Cleanup on unmount
     ---------------------------------------------------------- */
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopRef.current();
    };
  }, []);

  return {
    ...state,
    start,
    stop,
    pause,
    resume,
    setEnabled,
  };
}
