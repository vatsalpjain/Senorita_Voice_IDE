"use client";

import { useState, useEffect, useRef, useCallback } from "react";

/* ============================================================
   useTTS — Text-to-Speech hook wrapping window.speechSynthesis
   ============================================================ */

export interface TTSOptions {
  rate?: number;   // 0.1 – 10, default 1
  pitch?: number;  // 0 – 2,   default 1
  volume?: number; // 0 – 1,   default 1
  lang?: string;   // BCP-47,  default "en-US"
}

export interface UseTTSReturn {
  isSupported: boolean;
  isSpeaking: boolean;
  autoSpeak: boolean;
  setAutoSpeak: (v: boolean) => void;
  speak: (text: string) => void;
  stop: () => void;
  toggle: () => void;
}

export function useTTS(options: TTSOptions = {}): UseTTSReturn {
  const {
    rate   = 1,
    pitch  = 1,
    volume = 1,
    lang   = "en-US",
  } = options;

  const isSupported =
    typeof window !== "undefined" && "speechSynthesis" in window;

  const [isSpeaking, setIsSpeaking]   = useState(false);
  const [autoSpeak, setAutoSpeak]     = useState(true);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  /* Cancel any ongoing speech when the hook unmounts */
  useEffect(() => {
    return () => {
      if (isSupported) window.speechSynthesis.cancel();
    };
  }, [isSupported]);

  /* Keep isSpeaking in sync if synthesis ends externally */
  useEffect(() => {
    if (!isSupported) return;
    const id = setInterval(() => {
      if (!window.speechSynthesis.speaking && isSpeaking) {
        setIsSpeaking(false);
      }
    }, 200);
    return () => clearInterval(id);
  }, [isSupported, isSpeaking]);

  const speak = useCallback((text: string) => {
    if (!isSupported || !text.trim()) return;

    /* Cancel whatever is currently playing */
    window.speechSynthesis.cancel();

    const utt = new SpeechSynthesisUtterance(text);
    utt.lang   = lang;
    utt.rate   = rate;
    utt.pitch  = pitch;
    utt.volume = volume;

    utt.onstart = () => setIsSpeaking(true);
    utt.onend   = () => setIsSpeaking(false);
    utt.onerror = () => setIsSpeaking(false);

    utteranceRef.current = utt;
    window.speechSynthesis.speak(utt);
  }, [isSupported, lang, rate, pitch, volume]);

  const stop = useCallback(() => {
    if (!isSupported) return;
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
  }, [isSupported]);

  const toggle = useCallback(() => {
    if (isSpeaking) {
      stop();
    }
  }, [isSpeaking, stop]);

  return { isSupported, isSpeaking, autoSpeak, setAutoSpeak, speak, stop, toggle };
}
