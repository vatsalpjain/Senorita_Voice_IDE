"use client";

import { useState, useEffect, useRef, useCallback } from "react";

/* ============================================================
   TYPES
   ============================================================ */
export type VoiceStatus =
  | "idle"
  | "requesting"
  | "listening"
  | "processing"
  | "error"
  | "unsupported";

export interface VoiceState {
  status: VoiceStatus;
  transcript: string;
  interimTranscript: string;
  error: string | null;
  isSupported: boolean;
}

export interface UseVoiceOptions {
  lang?: string;
  continuous?: boolean;
  interimResults?: boolean;
  onFinalTranscript?: (transcript: string) => void;
  onInterimTranscript?: (transcript: string) => void;
  onError?: (error: string) => void;
}

export interface UseVoiceReturn extends VoiceState {
  startListening: () => void;
  stopListening: () => void;
  resetTranscript: () => void;
  toggle: () => void;
}

/* ============================================================
   HOOK
   ============================================================ */
export function useVoice(options: UseVoiceOptions = {}): UseVoiceReturn {
  const {
    lang = "en-US",
    continuous = false,
    interimResults = true,
    onFinalTranscript,
    onInterimTranscript,
    onError,
  } = options;

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const isSupported =
    typeof window !== "undefined" &&
    !!(window.SpeechRecognition || window.webkitSpeechRecognition);

  const [state, setState] = useState<VoiceState>({
    status: isSupported ? "idle" : "unsupported",
    transcript: "",
    interimTranscript: "",
    error: null,
    isSupported,
  });

  /* ----------------------------------------------------------
     Build / configure the recognition instance
     ---------------------------------------------------------- */
  const initRecognition = useCallback((): SpeechRecognition | null => {
    if (!isSupported) return null;

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SR();
    rec.lang = lang;
    rec.continuous = continuous;
    rec.interimResults = interimResults;
    rec.maxAlternatives = 1;

    rec.onstart = () => {
      setState((prev) => ({ ...prev, status: "listening", error: null }));
    };

    rec.onresult = (event: SpeechRecognitionEvent) => {
      let interim = "";
      let finalText = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalText += result[0].transcript;
        } else {
          interim += result[0].transcript;
        }
      }

      if (finalText) {
        setState((prev) => ({
          ...prev,
          transcript: prev.transcript + finalText,
          interimTranscript: "",
        }));
        onFinalTranscript?.(finalText.trim());
      }

      if (interim) {
        setState((prev) => ({ ...prev, interimTranscript: interim }));
        onInterimTranscript?.(interim.trim());
      }
    };

    rec.onerror = (event: SpeechRecognitionErrorEvent) => {
      let msg = "Speech recognition error";
      switch (event.error) {
        case "not-allowed":
          msg = "Microphone permission denied. Please allow access in browser settings.";
          break;
        case "no-speech":
          msg = "No speech detected. Please try again.";
          break;
        case "network":
          msg = "Network error during speech recognition.";
          break;
        case "aborted":
          msg = "Recognition was aborted.";
          break;
        case "audio-capture":
          msg = "No microphone found. Please connect a microphone.";
          break;
        default:
          msg = `Recognition error: ${event.error}`;
      }
      setState((prev) => ({ ...prev, status: "error", error: msg }));
      onError?.(msg);
    };

    rec.onend = () => {
      setState((prev) => {
        if (prev.status === "listening" || prev.status === "processing") {
          return { ...prev, status: "idle", interimTranscript: "" };
        }
        return { ...prev, interimTranscript: "" };
      });
    };

    return rec;
  }, [lang, continuous, interimResults, onFinalTranscript, onInterimTranscript, onError, isSupported]);

  /* ----------------------------------------------------------
     Controls
     ---------------------------------------------------------- */
  const startListening = useCallback(() => {
    if (!isSupported) {
      setState((prev) => ({
        ...prev,
        status: "unsupported",
        error: "Web Speech API is not supported in this browser. Please use Chrome or Edge.",
      }));
      return;
    }

    // Stop existing session if any
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch (_) { /* ignore */ }
    }

    const rec = initRecognition();
    if (!rec) return;

    recognitionRef.current = rec;
    setState((prev) => ({ ...prev, status: "requesting", error: null }));

    try {
      rec.start();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to start recognition";
      setState((prev) => ({ ...prev, status: "error", error: msg }));
    }
  }, [isSupported, initRecognition]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch (_) { /* ignore */ }
    }
    setState((prev) => ({ ...prev, status: "idle", interimTranscript: "" }));
  }, []);

  const resetTranscript = useCallback(() => {
    setState((prev) => ({ ...prev, transcript: "", interimTranscript: "", error: null }));
  }, []);

  const toggle = useCallback(() => {
    if (state.status === "listening" || state.status === "requesting") {
      stopListening();
    } else {
      startListening();
    }
  }, [state.status, startListening, stopListening]);

  /* ----------------------------------------------------------
     Cleanup on unmount
     ---------------------------------------------------------- */
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try { recognitionRef.current.abort(); } catch (_) { /* ignore */ }
      }
    };
  }, []);

  return {
    ...state,
    startListening,
    stopListening,
    resetTranscript,
    toggle,
  };
}
