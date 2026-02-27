"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useVoice, VoiceStatus } from "../hooks/useVoice";
import { useTTS } from "../hooks/useTTS";
import {
  sendVoiceCommandWithFallback,
  EditorContext,
  AICommandResponse,
  classifyIntent,
} from "../services/aiService";

/* ============================================================
   TYPES
   ============================================================ */
export interface VoicePanelProps {
  editorContext: EditorContext;
  onAIResponse: (response: AICommandResponse) => void;
  onTranscriptChange?: (transcript: string) => void;
}

type MessageRole = "user" | "assistant" | "error";

interface ChatMessage {
  id: string;
  role: MessageRole;
  text: string;
  code: string | null;
  intent?: string;
  insertMode?: string;
  usedMock?: boolean;
  timestamp: Date;
}

/* ============================================================
   KEYFRAME STYLES
   ============================================================ */
const VP_STYLES = `
  @keyframes vpWaveBar {
    0%,100% { transform: scaleY(0.2); }
    50%     { transform: scaleY(1);   }
  }
  @keyframes vpMicPulse {
    0%,100% { box-shadow: 0 0 0 0 rgba(0,212,232,0.5); }
    50%     { box-shadow: 0 0 0 12px rgba(0,212,232,0); }
  }
  @keyframes vpSpin {
    from { transform: rotate(0deg);   }
    to   { transform: rotate(360deg); }
  }
  @keyframes vpSlideIn {
    from { opacity:0; transform:translateY(8px); }
    to   { opacity:1; transform:translateY(0);   }
  }
  @keyframes vpBlink {
    0%,100% { opacity:1; }
    50%     { opacity:0; }
  }
`;

/* ============================================================
   WAVEFORM (inline, small — used inside the input bar)
   ============================================================ */
const WAVE_TIMINGS = [
  { delay: "0s",    dur: "0.55s" },
  { delay: "0.1s",  dur: "0.62s" },
  { delay: "0.05s", dur: "0.70s" },
  { delay: "0.15s", dur: "0.50s" },
  { delay: "0.08s", dur: "0.58s" },
];

function MiniWaveform({ active }: { active: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 2, height: 16, flexShrink: 0 }}>
      {WAVE_TIMINGS.map((t, i) => (
        <div key={i} style={{
          width: 2, height: "100%", borderRadius: 1,
          background: active ? "#00D4E8" : "#2A3555",
          transformOrigin: "center",
          animation: active ? `vpWaveBar ${t.dur} ease-in-out infinite ${t.delay}` : "none",
          opacity: active ? 1 : 0.4,
          transition: "background 0.25s",
        }} />
      ))}
    </div>
  );
}

/* ============================================================
   INTENT BADGE
   ============================================================ */
const INTENT_META: Record<string, { color: string; bg: string }> = {
  generate: { color: "#00E5A0", bg: "rgba(0,229,160,0.12)"   },
  refactor: { color: "#00D4E8", bg: "rgba(0,212,232,0.12)"   },
  explain:  { color: "#F6C90E", bg: "rgba(246,201,14,0.12)"  },
  fix:      { color: "#FF4D6D", bg: "rgba(255,77,109,0.12)"  },
  test:     { color: "#8A9BB8", bg: "rgba(138,155,184,0.12)" },
  document: { color: "#4DD9E8", bg: "rgba(77,217,232,0.12)"  },
  unknown:  { color: "#5A6888", bg: "rgba(42,53,85,0.2)"     },
};

function IntentBadge({ intent }: { intent: string }) {
  const m = INTENT_META[intent] ?? INTENT_META.unknown;
  return (
    <span style={{
      background: m.bg, color: m.color,
      fontSize: "0.58rem", fontFamily: "'JetBrains Mono', monospace",
      padding: "1px 6px", borderRadius: 100,
      letterSpacing: "0.06em", textTransform: "uppercase", flexShrink: 0,
    }}>
      {intent}
    </span>
  );
}

/* ============================================================
   CHAT BUBBLE
   ============================================================ */
function ChatBubble({ msg, onRerun }: { msg: ChatMessage; onRerun: (t: string) => void }) {
  const [codeOpen, setCodeOpen] = useState(false);
  const isUser = msg.role === "user";
  const isErr  = msg.role === "error";
  const ts = msg.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <div style={{
      display: "flex", flexDirection: "column",
      alignItems: isUser ? "flex-end" : "flex-start",
      padding: "4px 12px",
      animation: "vpSlideIn 0.22s ease forwards",
    }}>
      {/* Bubble */}
      <div style={{
        maxWidth: "88%",
        background: isErr
          ? "rgba(255,77,109,0.1)"
          : isUser
          ? "rgba(0,212,232,0.1)"
          : "#111824",
        border: `1px solid ${
          isErr ? "rgba(255,77,109,0.25)" : isUser ? "rgba(0,212,232,0.2)" : "#1A2033"
        }`,
        borderRadius: isUser ? "12px 12px 2px 12px" : "12px 12px 12px 2px",
        padding: "8px 11px",
      }}>
        {/* Intent badge — assistant only */}
        {!isUser && !isErr && msg.intent && (
          <div style={{ marginBottom: 5 }}>
            <IntentBadge intent={msg.intent} />
          </div>
        )}

        {/* Message text */}
        <p style={{
          fontSize: "0.78rem", lineHeight: 1.55, margin: 0,
          color: isErr ? "#FF4D6D" : isUser ? "#C8D5E8" : "#9BAAC8",
          fontFamily: "'DM Sans', sans-serif",
          whiteSpace: "pre-wrap", wordBreak: "break-word",
        }}>
          {msg.text}
        </p>

        {/* Code toggle — assistant only */}
        {!isUser && msg.code && (
          <div style={{ marginTop: 8 }}>
            <button
              onClick={() => setCodeOpen(v => !v)}
              style={{
                background: "transparent",
                border: "1px solid #1A2033",
                borderRadius: 4, padding: "2px 8px",
                color: "#3A4560", fontSize: "0.65rem",
                fontFamily: "'JetBrains Mono', monospace",
                cursor: "pointer", transition: "all 0.15s",
                display: "flex", alignItems: "center", gap: 5,
              }}
              onMouseEnter={e => { e.currentTarget.style.color = "#4DD9E8"; e.currentTarget.style.borderColor = "rgba(77,217,232,0.3)"; }}
              onMouseLeave={e => { e.currentTarget.style.color = "#3A4560"; e.currentTarget.style.borderColor = "#1A2033"; }}
            >
              <span style={{ transform: codeOpen ? "rotate(90deg)" : "none", display: "inline-block", transition: "transform 0.15s" }}>▶</span>
              {codeOpen ? "Hide code" : "Show inserted code"}
              {msg.insertMode && (
                <span style={{ color: "#2A3555", marginLeft: 4 }}>· {msg.insertMode}</span>
              )}
            </button>
            {codeOpen && (
              <pre style={{
                marginTop: 6, background: "#08090F",
                border: "1px solid #1A2033", borderRadius: 6,
                padding: "8px 10px", fontSize: "0.7rem", color: "#4DD9E8",
                fontFamily: "'JetBrains Mono', monospace",
                whiteSpace: "pre-wrap", wordBreak: "break-all",
                maxHeight: 180, overflowY: "auto", margin: 0,
              }}>
                {msg.code}
              </pre>
            )}
          </div>
        )}

        {/* Mock indicator */}
        {msg.usedMock && (
          <div style={{ marginTop: 6, fontSize: "0.6rem", color: "#2A3555", fontFamily: "'JetBrains Mono', monospace" }}>
            mock · backend offline
          </div>
        )}
      </div>

      {/* Timestamp + re-run */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 3, paddingRight: isUser ? 2 : 0, paddingLeft: isUser ? 0 : 2 }}>
        <span style={{ fontSize: "0.6rem", color: "#2A3555", fontFamily: "'JetBrains Mono', monospace" }}>{ts}</span>
        {isUser && (
          <button
            onClick={() => onRerun(msg.text)}
            style={{ background: "none", border: "none", color: "#2A3555", fontSize: "0.62rem", cursor: "pointer", fontFamily: "'JetBrains Mono', monospace", padding: 0, transition: "color 0.15s" }}
            onMouseEnter={e => (e.currentTarget.style.color = "#00D4E8")}
            onMouseLeave={e => (e.currentTarget.style.color = "#2A3555")}
          >
            ↺
          </button>
        )}
      </div>
    </div>
  );
}

/* ============================================================
   MAIN VOICE PANEL — Chat style
   ============================================================ */
export function VoicePanel({
  editorContext,
  onAIResponse,
  onTranscriptChange,
}: VoicePanelProps): React.ReactElement {
  const [messages, setMessages]           = useState<ChatMessage[]>([]);
  const [textInput, setTextInput]         = useState("");
  const [isProcessing, setIsProcessing]   = useState(false);

  const abortRef      = useRef<AbortController | null>(null);
  const chatEndRef    = useRef<HTMLDivElement>(null);
  const textareaRef   = useRef<HTMLTextAreaElement>(null);

  /* ── Auto-grow textarea ── */
  const autoGrow = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  };

  /* ── Auto-scroll to bottom on new message ── */
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  /* ── Cleanup on unmount ── */
  useEffect(() => () => { abortRef.current?.abort(); }, []);

  /* ── Core command handler (shared by voice + text) ── */
  const handleCommand = useCallback(async (transcript: string) => {
    const trimmed = transcript.trim();
    if (!trimmed || isProcessing) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      text: trimmed,
      code: null,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMsg]);
    setIsProcessing(true);
    onTranscriptChange?.(trimmed);

    try {
      const result = await sendVoiceCommandWithFallback(
        { transcript: trimmed, context: editorContext },
        controller.signal
      );
      const { usedMock, ...response } = result;
      onAIResponse(response);

      const assistantMsg: ChatMessage = {
        id: `a-${Date.now()}`,
        role: "assistant",
        text: response.explanation,
        code: response.code,
        intent: response.intent,
        insertMode: response.insertMode,
        usedMock: !!usedMock,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, assistantMsg]);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      const errMsg: ChatMessage = {
        id: `e-${Date.now()}`,
        role: "error",
        text: err instanceof Error ? err.message : "Unknown error occurred.",
        code: null,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errMsg]);
    } finally {
      setIsProcessing(false);
    }
  }, [isProcessing, editorContext, onAIResponse, onTranscriptChange]);

  /* ── Voice hook ── */
  const voice = useVoice({
    lang: "en-US",
    continuous: false,
    interimResults: true,
    onFinalTranscript: (text) => handleCommand(text),
    onError: (err) => {
      const errMsg: ChatMessage = {
        id: `e-${Date.now()}`,
        role: "error",
        text: err,
        code: null,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errMsg]);
    },
  });

  /* ── TTS hook ── */
  const tts = useTTS({ rate: 1, pitch: 1, volume: 1, lang: "en-US" });

  /* ── Auto-speak every new assistant message when autoSpeak is on ── */
  useEffect(() => {
    if (!tts.autoSpeak || !tts.isSupported) return;
    if (messages.length === 0) return;
    const last = messages[messages.length - 1];
    if (last.role !== "assistant") return;
    tts.speak(last.text);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  /* ── Text submit ── */
  const handleTextSubmit = () => {
    if (!textInput.trim() || isProcessing) return;
    handleCommand(textInput);
    setTextInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "36px";
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleTextSubmit();
    }
  };

  const isActive      = voice.status === "listening" || voice.status === "requesting";
  const liveInterim   = voice.interimTranscript;
  const detectedIntent = liveInterim ? classifyIntent(liveInterim) : null;

  return (
    <>
      <style>{VP_STYLES}</style>

      <div style={{
        display: "flex", flexDirection: "column", height: "100%",
        background: "#08090F", fontFamily: "'DM Sans', sans-serif",
        overflow: "hidden",
      }}>

        {/* ── Panel header ── */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "0 12px", height: 36,
          borderBottom: "1px solid #111824", flexShrink: 0,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <span style={{
              fontSize: "0.6rem", letterSpacing: "0.1em", textTransform: "uppercase",
              fontFamily: "'JetBrains Mono', monospace", color: "#2A3555",
            }}>AI Assistant</span>
            {/* Status dot */}
            <span style={{
              width: 5, height: 5, borderRadius: "50%", display: "inline-block",
              background: isActive ? "#00D4E8" : isProcessing ? "#F6C90E" : "#2A3555",
              boxShadow: isActive ? "0 0 5px #00D4E8" : "none",
              transition: "background 0.3s",
            }} />
            <span style={{
              fontSize: "0.6rem", fontFamily: "'JetBrains Mono', monospace",
              color: isActive ? "#00D4E8" : isProcessing ? "#F6C90E" : "#2A3555",
              transition: "color 0.3s",
            }}>
              {isActive ? "Listening…" : isProcessing ? "Thinking…" : voice.isSupported ? "Ready" : "Text only"}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {/* Stop speaking button — visible while TTS is active */}
            {tts.isSpeaking && (
              <button
                onClick={tts.stop}
                title="Stop speaking"
                style={{
                  display: "flex", alignItems: "center", gap: 4,
                  background: "rgba(0,212,232,0.1)",
                  border: "1px solid rgba(0,212,232,0.35)",
                  color: "#00D4E8", fontSize: "0.58rem", padding: "2px 7px",
                  borderRadius: 3, cursor: "pointer",
                  fontFamily: "'JetBrains Mono', monospace",
                  animation: "vpMicPulse 1.8s ease-in-out infinite",
                }}
              >
                <svg width="8" height="8" viewBox="0 0 8 8" fill="#00D4E8">
                  <rect x="0" y="0" width="8" height="8" rx="1" />
                </svg>
                stop
              </button>
            )}

            {/* Auto-speak toggle */}
            {tts.isSupported && (
              <button
                onClick={() => {
                  tts.setAutoSpeak(!tts.autoSpeak);
                  if (tts.isSpeaking) tts.stop();
                }}
                title={tts.autoSpeak ? "Auto-speak ON — click to turn off" : "Auto-speak OFF — click to turn on"}
                style={{
                  display: "flex", alignItems: "center", gap: 4,
                  background: tts.autoSpeak ? "rgba(0,229,160,0.1)" : "transparent",
                  border: `1px solid ${tts.autoSpeak ? "rgba(0,229,160,0.35)" : "#1A2033"}`,
                  color: tts.autoSpeak ? "#00E5A0" : "#2A3555",
                  fontSize: "0.58rem", padding: "2px 7px",
                  borderRadius: 3, cursor: "pointer",
                  fontFamily: "'JetBrains Mono', monospace", transition: "all 0.2s",
                }}
                onMouseEnter={e => { if (!tts.autoSpeak) { e.currentTarget.style.color = "#00E5A0"; e.currentTarget.style.borderColor = "rgba(0,229,160,0.3)"; }}}
                onMouseLeave={e => { if (!tts.autoSpeak) { e.currentTarget.style.color = "#2A3555"; e.currentTarget.style.borderColor = "#1A2033"; }}}
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none"
                  stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
                  <path d="M1 3.5h2l2.5-2.5v8L3 6.5H1z" />
                  {tts.autoSpeak ? (
                    <>
                      <path d="M7 3.5a2.5 2.5 0 0 1 0 3.5" />
                      <path d="M8.5 2a5 5 0 0 1 0 6.5" />
                    </>
                  ) : (
                    <line x1="7" y1="3.5" x2="9.5" y2="7" />
                  )}
                </svg>
                {tts.autoSpeak ? "voice on" : "voice off"}
              </button>
            )}

            {/* Clear chat */}
            {messages.length > 0 && (
              <button
                onClick={() => { setMessages([]); tts.stop(); }}
                style={{
                  background: "none", border: "1px solid #1A2033",
                  color: "#2A3555", fontSize: "0.58rem", padding: "2px 7px",
                  borderRadius: 3, cursor: "pointer",
                  fontFamily: "'JetBrains Mono', monospace", transition: "all 0.15s",
                }}
                onMouseEnter={e => { e.currentTarget.style.color = "#FF4D6D"; e.currentTarget.style.borderColor = "rgba(255,77,109,0.3)"; }}
                onMouseLeave={e => { e.currentTarget.style.color = "#2A3555"; e.currentTarget.style.borderColor = "#1A2033"; }}
              >clear</button>
            )}
          </div>
        </div>

        {/* ── Chat messages ── */}
        <div style={{ flex: 1, overflowY: "auto", padding: "10px 0 6px" }}>
          {messages.length === 0 ? (
            <div style={{
              display: "flex", flexDirection: "column", alignItems: "center",
              justifyContent: "center", height: "100%", gap: 10,
              padding: "24px 20px", textAlign: "center",
            }}>
              <div style={{
                width: 44, height: 44, borderRadius: "50%",
                background: "rgba(0,212,232,0.06)", border: "1px solid #1A2033",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none"
                  stroke="#2A3555" strokeWidth="1.4" strokeLinecap="round">
                  <rect x="6.5" y="1" width="7" height="12" rx="3.5" />
                  <path d="M3 10.5a7 7 0 0 0 14 0" />
                  <line x1="10" y1="17.5" x2="10" y2="19" />
                  <line x1="7.5" y1="19" x2="12.5" y2="19" />
                </svg>
              </div>
              <p style={{ fontSize: "0.75rem", color: "#3A4560", margin: 0 }}>
                Ask anything about your code
              </p>
              <div style={{ fontSize: "0.68rem", color: "#2A3555", lineHeight: 1.6 }}>
                <span style={{ color: "#4DD9E8" }}>"generate a fetch helper"</span><br />
                <span style={{ color: "#4DD9E8" }}>"refactor this to async/await"</span><br />
                <span style={{ color: "#4DD9E8" }}>"explain what this does"</span>
              </div>
            </div>
          ) : (
            messages.map(msg => (
              <ChatBubble key={msg.id} msg={msg} onRerun={handleCommand} />
            ))
          )}

          {/* Typing / listening indicator */}
          {(isProcessing || isActive) && (
            <div style={{
              display: "flex", flexDirection: "column",
              alignItems: "flex-start", padding: "4px 12px",
              animation: "vpSlideIn 0.2s ease forwards",
            }}>
              {isActive && liveInterim && (
                <div style={{
                  maxWidth: "88%", background: "rgba(0,212,232,0.08)",
                  border: "1px solid rgba(0,212,232,0.15)",
                  borderRadius: "12px 12px 12px 2px",
                  padding: "6px 10px", marginBottom: 4,
                }}>
                  <p style={{
                    fontSize: "0.76rem", color: "#8A9BB8", margin: 0, fontStyle: "italic",
                    fontFamily: "'DM Sans', sans-serif",
                  }}>
                    {liveInterim}
                    <span style={{ animation: "vpBlink 0.9s ease-in-out infinite", color: "#00D4E8", marginLeft: 2 }}>│</span>
                  </p>
                  {detectedIntent && detectedIntent !== "unknown" && (
                    <div style={{ marginTop: 4 }}>
                      <IntentBadge intent={detectedIntent} />
                    </div>
                  )}
                </div>
              )}
              {isProcessing && (
                <div style={{
                  background: "#111824", border: "1px solid #1A2033",
                  borderRadius: "12px 12px 12px 2px", padding: "8px 14px",
                  display: "flex", alignItems: "center", gap: 6,
                }}>
                  {[0, 1, 2].map(i => (
                    <div key={i} style={{
                      width: 6, height: 6, borderRadius: "50%",
                      background: "#00D4E8",
                      animation: `vpWaveBar 1s ease-in-out infinite ${i * 0.18}s`,
                      transformOrigin: "center",
                    }} />
                  ))}
                </div>
              )}
            </div>
          )}

          <div ref={chatEndRef} />
        </div>

        {/* ── Input bar ── */}
        <div style={{
          flexShrink: 0, borderTop: "1px solid #111824",
          padding: "8px 10px",
          background: "#08090F",
        }}>
          <div style={{
            display: "flex", alignItems: "flex-end", gap: 8,
            background: "#0E111A",
            border: `1px solid ${isActive ? "rgba(0,212,232,0.4)" : "#1A2033"}`,
            borderRadius: 10, padding: "6px 8px",
            transition: "border-color 0.2s",
          }}>
            {/* Textarea */}
            <textarea
              ref={textareaRef}
              value={textInput}
              onChange={e => { setTextInput(e.target.value); autoGrow(); }}
              onKeyDown={handleKeyDown}
              placeholder={voice.isSupported ? "Message or press mic to speak…" : "Type a command…"}
              disabled={isProcessing}
              rows={1}
              style={{
                flex: 1, background: "transparent", border: "none", outline: "none",
                color: "#C8D5E8", fontSize: "0.8rem", lineHeight: 1.5,
                fontFamily: "'DM Sans', sans-serif",
                resize: "none", overflowY: "hidden",
                minHeight: 22, maxHeight: 120,
                padding: 0, margin: 0,
                opacity: isProcessing ? 0.5 : 1,
              }}
            />

            {/* Waveform — shown when listening */}
            {isActive && (
              <div style={{ paddingBottom: 3, flexShrink: 0 }}>
                <MiniWaveform active={true} />
              </div>
            )}

            {/* Send button */}
            <button
              onClick={handleTextSubmit}
              disabled={!textInput.trim() || isProcessing}
              title="Send (Enter)"
              style={{
                width: 30, height: 30, borderRadius: 7, flexShrink: 0,
                background: textInput.trim() && !isProcessing
                  ? "#00D4E8" : "rgba(0,212,232,0.06)",
                border: `1px solid ${textInput.trim() && !isProcessing ? "#00D4E8" : "#1A2033"}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                cursor: textInput.trim() && !isProcessing ? "pointer" : "not-allowed",
                transition: "all 0.18s", flexDirection: "column",
              }}
            >
              {isProcessing ? (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"
                  style={{ animation: "vpSpin 0.8s linear infinite" }}>
                  <circle cx="7" cy="7" r="5.5" stroke="#00D4E8" strokeWidth="1.8" strokeDasharray="20 16" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"
                  stroke={textInput.trim() ? "#07090E" : "#2A3555"} strokeWidth="1.8"
                  strokeLinecap="round" strokeLinejoin="round">
                  <line x1="7" y1="12" x2="7" y2="2" />
                  <polyline points="3,6 7,2 11,6" />
                </svg>
              )}
            </button>

            {/* Mic button — right-most, bottom-right of input bar */}
            <button
              onClick={voice.toggle}
              disabled={!voice.isSupported || isProcessing}
              title={
                !voice.isSupported ? "Speech not supported in this browser" :
                isActive ? "Stop listening" : "Start voice input"
              }
              style={{
                width: 30, height: 30, borderRadius: 7, flexShrink: 0,
                background: isActive
                  ? "rgba(0,212,232,0.18)"
                  : "rgba(0,212,232,0.06)",
                border: `1.5px solid ${isActive ? "rgba(0,212,232,0.7)" : "#1A2033"}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                cursor: !voice.isSupported || isProcessing ? "not-allowed" : "pointer",
                transition: "all 0.18s",
                animation: isActive ? "vpMicPulse 1.8s ease-in-out infinite" : "none",
                opacity: !voice.isSupported ? 0.35 : 1,
              }}
            >
              {isActive ? (
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <rect x="2" y="2" width="8" height="8" rx="1.5" fill="#00D4E8" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"
                  stroke="#00D4E8" strokeWidth="1.5" strokeLinecap="round">
                  <rect x="4.5" y="1" width="5" height="7.5" rx="2.5" />
                  <path d="M2 7a5 5 0 0 0 10 0" />
                  <line x1="7" y1="12" x2="7" y2="13.5" />
                  <line x1="5" y1="13.5" x2="9" y2="13.5" />
                </svg>
              )}
            </button>
          </div>

          {/* Hint */}
          <div style={{
            display: "flex", justifyContent: "space-between",
            marginTop: 5, padding: "0 2px",
          }}>
            <span style={{ fontSize: "0.58rem", color: "#1A2033", fontFamily: "'JetBrains Mono', monospace" }}>
              Enter to send · Shift+Enter new line
            </span>
            <span style={{ fontSize: "0.58rem", color: "#1A2033", fontFamily: "'JetBrains Mono', monospace" }}>
              {messages.filter(m => m.role === "user").length} msgs
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
