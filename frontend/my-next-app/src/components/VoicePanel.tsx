"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useVoice } from "../hooks/useVoice";
import { useTTS } from "../hooks/useTTS";
import { useWebSocket, WSMessage } from "../hooks/useWebSocket";
import {
  EditorContext,
  AICommandResponse,
  classifyIntent,
  actionToIntent,
  WS_URL,
  WSIncomingMsg,
  buildAgenticCommand,
  CodeActionData,
  dispatchWSMessage,
  sendVoiceCommandWithFallback,
} from "../services/aiService";

/* ============================================================
   TYPES
   ============================================================ */
export interface CodeChange {
  heading: string;        // short title e.g. "Added error handler"
  description: string;    // one-line description of what changed
  action: string;         // insert | replace_file | replace_selection | delete_lines
  filename: string;       // which file
  code?: string;          // the actual code snippet
}

export interface VoicePanelProps {
  editorContext: EditorContext;
  onAIResponse: (response: AICommandResponse) => void;
  onTranscriptChange?: (transcript: string) => void;
  onCodeAction?: (action: CodeActionData) => void;
  onSummarize?: (messages: ChatMessage[], codeChanges: CodeChange[]) => void;
}

type MessageRole = "user" | "assistant" | "error";

export interface ChatMessage {
  id: string;
  role: MessageRole;
  text: string;
  code: string | null;
  intent?: string;
  insertMode?: string;
  usedMock?: boolean;
  isStreaming?: boolean; // true while LLM tokens are arriving
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
  { delay: "0s", dur: "0.55s" },
  { delay: "0.1s", dur: "0.62s" },
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
  generate: { color: "#00E5A0", bg: "rgba(0,229,160,0.12)" },
  refactor: { color: "#00D4E8", bg: "rgba(0,212,232,0.12)" },
  explain: { color: "#F6C90E", bg: "rgba(246,201,14,0.12)" },
  fix: { color: "#FF4D6D", bg: "rgba(255,77,109,0.12)" },
  test: { color: "#8A9BB8", bg: "rgba(138,155,184,0.12)" },
  document: { color: "#4DD9E8", bg: "rgba(77,217,232,0.12)" },
  unknown: { color: "#5A6888", bg: "rgba(42,53,85,0.2)" },
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
  const isErr = msg.role === "error";
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
        border: `1px solid ${isErr ? "rgba(255,77,109,0.25)" : isUser ? "rgba(0,212,232,0.2)" : "#1A2033"
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
          {/* Blinking cursor while streaming */}
          {msg.isStreaming && (
            <span style={{ animation: "vpBlink 0.9s ease-in-out infinite", color: "#00D4E8", marginLeft: 2 }}>│</span>
          )}
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
  onCodeAction,
  onSummarize,
}: VoicePanelProps): React.ReactElement {
  const [messages, setMessages]         = useState<ChatMessage[]>([]);
  const [textInput, setTextInput]       = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [codeChanges, setCodeChanges]   = useState<CodeChange[]>([]);

  const chatEndRef      = useRef<HTMLDivElement>(null);
  const textareaRef     = useRef<HTMLTextAreaElement>(null);
  const streamBubbleId  = useRef<string | null>(null);
  const streamChunks    = useRef<string[]>([]);

  /* ── Summarize handler ── */
  const handleSummarize = useCallback(async () => {
    const relevant = messages.filter(m => m.role !== "error");
    if (relevant.length === 0) return;
    if (onSummarize) {
      onSummarize(relevant, codeChanges);
      return;
    }
    // Fallback: direct API call if no parent handler
    setIsSummarizing(true);
    try {
      const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
      const res = await fetch(`${API_BASE}/api/summarize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: relevant.map(m => ({ role: m.role, text: m.text, intent: m.intent ?? null })),
          filename: editorContext.filename || null,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      console.log("[VoicePanel] Summary:", data);
    } catch (err) {
      console.error("[VoicePanel] Summarize error:", err);
    } finally {
      setIsSummarizing(false);
    }
  }, [messages, codeChanges, onSummarize, editorContext.filename]);

  /* ── Auto-grow textarea ── */
  const autoGrow = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  };

  /* ── Auto-scroll ── */
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  /* ── TTS ── */
  const tts = useTTS({ rate: 1, pitch: 1, volume: 1, lang: "en-US" });

  /* ── WebSocket connection ── */
  const ws = useWebSocket({
    url: WS_URL,
    autoConnect: true,
    onMessage: useCallback((msg: WSMessage) => {
      console.log("[VoicePanel] WS message received:", msg);
      dispatchWSMessage(msg as WSIncomingMsg, {
        onAction: (action, param) => {
          // Create the streaming assistant bubble
          const bubbleId = `a-${Date.now()}`;
          streamBubbleId.current = bubbleId;
          streamChunks.current = [];

          const intent = actionToIntent(action);
          const streamingMsg: ChatMessage = {
            id: bubbleId,
            role: "assistant",
            text: "",
            code: null,
            intent,
            isStreaming: true,
            timestamp: new Date(),
          };
          setMessages(prev => [...prev, streamingMsg]);
        },

        onChunk: (chunk) => {
          streamChunks.current.push(chunk);
          const accumulated = streamChunks.current.join("");

          setMessages(prev =>
            prev.map(m =>
              m.id === streamBubbleId.current
                ? { ...m, text: accumulated }
                : m
            )
          );
        },

        onComplete: (text: string, action: string, code: string | null) => {
          const intent = actionToIntent(action);

          // Finalize the streaming bubble
          setMessages(prev =>
            prev.map(m =>
              m.id === streamBubbleId.current
                ? { ...m, text, code, intent, isStreaming: false }
                : m
            )
          );

          streamBubbleId.current = null;
          streamChunks.current = [];
          setIsProcessing(false);
        },

        onError: (message) => {
          const errMsg: ChatMessage = {
            id: `e-${Date.now()}`,
            role: "error",
            text: message,
            code: null,
            timestamp: new Date(),
          };
          setMessages(prev => [...prev, errMsg]);
          setIsProcessing(false);
          streamBubbleId.current = null;
          streamChunks.current = [];
        },

        // Agentic workflow callbacks
        onIntent: (intent) => {
          console.log("[VoicePanel] onIntent:", intent);
          // Create streaming bubble for agentic response
          const bubbleId = `a-${Date.now()}`;
          streamBubbleId.current = bubbleId;
          const streamingMsg: ChatMessage = {
            id: bubbleId,
            role: "assistant",
            text: `Processing ${intent} request...`,
            code: null,
            intent,
            isStreaming: true,
            timestamp: new Date(),
          };
          setMessages(prev => [...prev, streamingMsg]);
        },

        onCodeAction: (data) => {
          // Notify parent to show pending action in Monaco
          onCodeAction?.(data);

          // Track each edit as a code change for the summary
          if (data.edits && data.edits.length > 0) {
            const actionLabels: Record<string, string> = {
              insert: "Inserted code",
              replace_file: "Replaced file content",
              replace_selection: "Replaced selection",
              delete_lines: "Deleted lines",
              create_file: "Created file",
            };
            const newChanges: CodeChange[] = data.edits.map(edit => ({
              heading: actionLabels[edit.action] ?? "Code change",
              description: data.explanation || "AI made a code change",
              action: edit.action,
              filename: edit.file_path || editorContext.filename || "untitled",
              code: edit.code?.slice(0, 300),
            }));
            setCodeChanges(prev => [...prev, ...newChanges]);
          }

          // Update the streaming bubble with code action info
          setMessages(prev =>
            prev.map(m =>
              m.id === streamBubbleId.current
                ? { ...m, text: data.explanation || "Code generated", code: data.edits?.[0]?.code, isStreaming: false }
                : m
            )
          );
          setIsProcessing(false);
          streamBubbleId.current = null;
        },

        onExplanation: (text) => {
          console.log("[VoicePanel] onExplanation:", text?.substring(0, 100));
          // Update streaming bubble with explanation text (don't finalize yet - wait for response_complete)
          if (streamBubbleId.current) {
            setMessages(prev =>
              prev.map(m =>
                m.id === streamBubbleId.current
                  ? { ...m, text: text || "Processing..." }
                  : m
              )
            );
          }
        },

        onAgentComplete: (intent, result, text) => {
          console.log("[VoicePanel] onAgentComplete:", { intent, text: text?.substring(0, 100) });
          // Finalize agentic response
          setMessages(prev =>
            prev.map(m =>
              m.id === streamBubbleId.current
                ? { ...m, text: text || "Done", intent, isStreaming: false }
                : m
            )
          );
          setIsProcessing(false);
          streamBubbleId.current = null;

          // Auto-speak via Web Speech TTS
          if (tts.autoSpeak && tts.isSupported && text) {
            tts.speak(text);
          }
        },
      });
    }, [onAIResponse, onCodeAction, tts]),
  });

  /* ── Core command handler (voice + text share this) ── */
  const handleCommand = useCallback(async (transcript: string) => {
    const trimmed = transcript.trim();
    if (!trimmed || isProcessing) return;

    setMessages(prev => [...prev, {
      id: `u-${Date.now()}`, role: "user",
      text: trimmed, code: null, timestamp: new Date(),
    }]);
    setIsProcessing(true);
    onTranscriptChange?.(trimmed);

    if (ws.isConnected) {
      // ── PRIMARY: WebSocket streaming ──
      // Use agentic_command when we have file context for full orchestrator workflow
      if (editorContext.filename && editorContext.filename !== "untitled") {
        console.log("[VoicePanel] Sending agentic_command with file_content length:", editorContext.currentCode?.length || 0);
        const agenticCmd = buildAgenticCommand({
          text: trimmed,
          file_path: editorContext.filename,
          file_content: editorContext.currentCode || "",
          cursor_line: editorContext.cursorLine || 1,
          selection: editorContext.selection || "",
          project_root: "",
          skip_tts: true,
        });
        ws.send(agenticCmd);
      } else {
        // Fallback to simple text_command when no file context
        ws.send({
          type: "text_command",
          text: trimmed,
          context: editorContext.currentCode || null,
          skip_tts: true,
        });
      }
      // Response handling happens in the onMessage callbacks above
    } else {
      // ── FALLBACK: REST with mock ──
      try {
        const result = await sendVoiceCommandWithFallback(
          { transcript: trimmed, context: editorContext },
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

        if (tts.autoSpeak && tts.isSupported && response.explanation) {
          tts.speak(response.explanation);
        }
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
    }
  }, [isProcessing, editorContext, onAIResponse, onTranscriptChange, ws, tts]);

  /* ── Voice hook ── */
  const voice = useVoice({
    lang: "en-US",
    continuous: false,
    interimResults: true,
    onFinalTranscript: handleCommand,
    onError: (err) => {
      setMessages(prev => [...prev, {
        id: `e-${Date.now()}`, role: "error",
        text: err, code: null, timestamp: new Date(),
      }]);
    },
  });

  /* ── Text submit ── */
  const handleTextSubmit = () => {
    if (!textInput.trim() || isProcessing) return;
    handleCommand(textInput);
    setTextInput("");
    if (textareaRef.current) textareaRef.current.style.height = "36px";
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleTextSubmit(); }
  };

  const isActive       = voice.status === "listening" || voice.status === "requesting";
  const liveInterim    = voice.interimTranscript;
  const detectedIntent = liveInterim ? classifyIntent(liveInterim) : null;
  const wsConnected    = ws.status === "connected";

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
            <span style={{
              width: 5, height: 5, borderRadius: "50%", display: "inline-block",
              background: isActive ? "#00D4E8" : isProcessing ? "#F6C90E"
                : wsConnected ? "#00E5A0" : "#FF4D6D",
              boxShadow: isActive ? "0 0 5px #00D4E8" : "none",
              transition: "background 0.3s",
            }} />
            <span style={{
              fontSize: "0.6rem", fontFamily: "'JetBrains Mono', monospace",
              color: isActive ? "#00D4E8" : isProcessing ? "#F6C90E"
                : wsConnected ? "#00E5A0" : "#FF4D6D",
              transition: "color 0.3s",
            }}>
              {isActive ? "Listening…"
                : isProcessing ? "Thinking…"
                : wsConnected ? "Connected"
                : ws.status === "connecting" ? "Connecting…"
                : "Offline (mock)"}
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {/* Stop TTS button */}
            {tts.isSpeaking && (
              <button onClick={tts.stop} title="Stop speaking" style={{
                display: "flex", alignItems: "center", gap: 4,
                background: "rgba(0,212,232,0.1)", border: "1px solid rgba(0,212,232,0.35)",
                color: "#00D4E8", fontSize: "0.58rem", padding: "2px 7px",
                borderRadius: 3, cursor: "pointer", fontFamily: "'JetBrains Mono', monospace",
                animation: "vpMicPulse 1.8s ease-in-out infinite",
              }}>
                <svg width="8" height="8" viewBox="0 0 8 8" fill="#00D4E8">
                  <rect x="0" y="0" width="8" height="8" rx="1" />
                </svg>
                stop
              </button>
            )}

            {/* Auto-speak toggle */}
            {tts.isSupported && (
              <button
                onClick={() => { tts.setAutoSpeak(!tts.autoSpeak); if (tts.isSpeaking) tts.stop(); }}
                title={tts.autoSpeak ? "Auto-speak ON — click to turn off" : "Auto-speak OFF — click to turn on"}
                style={{
                  display: "flex", alignItems: "center", gap: 4,
                  background: tts.autoSpeak ? "rgba(0,229,160,0.1)" : "transparent",
                  border: `1px solid ${tts.autoSpeak ? "rgba(0,229,160,0.35)" : "#1A2033"}`,
                  color: tts.autoSpeak ? "#00E5A0" : "#2A3555",
                  fontSize: "0.58rem", padding: "2px 7px", borderRadius: 3, cursor: "pointer",
                  fontFamily: "'JetBrains Mono', monospace", transition: "all 0.2s",
                }}
                onMouseEnter={e => { if (!tts.autoSpeak) { e.currentTarget.style.color = "#00E5A0"; e.currentTarget.style.borderColor = "rgba(0,229,160,0.3)"; }}}
                onMouseLeave={e => { if (!tts.autoSpeak) { e.currentTarget.style.color = "#2A3555"; e.currentTarget.style.borderColor = "#1A2033"; }}}
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none"
                  stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
                  <path d="M1 3.5h2l2.5-2.5v8L3 6.5H1z" />
                  {tts.autoSpeak ? (
                    <><path d="M7 3.5a2.5 2.5 0 0 1 0 3.5" /><path d="M8.5 2a5 5 0 0 1 0 6.5" /></>
                  ) : (
                    <line x1="7" y1="3.5" x2="9.5" y2="7" />
                  )}
                </svg>
                {tts.autoSpeak ? "voice on" : "voice off"}
              </button>
            )}

            {/* Summarize button */}
            {messages.filter(m => m.role !== "error").length > 0 && (
              <button
                onClick={handleSummarize}
                disabled={isSummarizing || isProcessing}
                title="Summarize conversation — generates flowcharts & diagrams"
                style={{
                  display: "flex", alignItems: "center", gap: 4,
                  background: isSummarizing ? "rgba(139,92,246,0.15)" : "rgba(139,92,246,0.08)",
                  border: `1px solid ${isSummarizing ? "rgba(139,92,246,0.5)" : "rgba(139,92,246,0.25)"}`,
                  color: isSummarizing ? "#A78BFA" : "#8B5CF6",
                  fontSize: "0.58rem", padding: "2px 7px",
                  borderRadius: 3, cursor: isSummarizing ? "default" : "pointer",
                  fontFamily: "'JetBrains Mono', monospace", transition: "all 0.2s",
                  opacity: isProcessing ? 0.4 : 1,
                }}
                onMouseEnter={e => { if (!isSummarizing && !isProcessing) { e.currentTarget.style.background = "rgba(139,92,246,0.18)"; e.currentTarget.style.borderColor = "rgba(139,92,246,0.5)"; e.currentTarget.style.color = "#C4B5FD"; }}}
                onMouseLeave={e => { if (!isSummarizing) { e.currentTarget.style.background = "rgba(139,92,246,0.08)"; e.currentTarget.style.borderColor = "rgba(139,92,246,0.25)"; e.currentTarget.style.color = "#8B5CF6"; }}}
              >
                {isSummarizing ? (
                  <svg width="9" height="9" viewBox="0 0 9 9" fill="none" style={{ animation: "vpSpin 0.8s linear infinite" }}>
                    <circle cx="4.5" cy="4.5" r="3.5" stroke="#A78BFA" strokeWidth="1.5" strokeDasharray="12 8" />
                  </svg>
                ) : (
                  <svg width="9" height="9" viewBox="0 0 9 9" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
                    <rect x="1" y="1" width="7" height="7" rx="1.5" />
                    <line x1="2.5" y1="3" x2="6.5" y2="3" />
                    <line x1="2.5" y1="4.5" x2="6.5" y2="4.5" />
                    <line x1="2.5" y1="6" x2="5" y2="6" />
                  </svg>
                )}
                {isSummarizing ? "analyzing…" : "summarize"}
              </button>
            )}

            {/* Clear */}
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
              <p style={{ fontSize: "0.75rem", color: "#3A4560", margin: 0 }}>Ask anything about your code</p>
              <div style={{ fontSize: "0.68rem", color: "#2A3555", lineHeight: 1.6 }}>
                <span style={{ color: "#4DD9E8" }}>&quot;generate a fetch helper&quot;</span><br />
                <span style={{ color: "#4DD9E8" }}>&quot;refactor this to async/await&quot;</span><br />
                <span style={{ color: "#4DD9E8" }}>&quot;open page.tsx and explain it&quot;</span>
              </div>
              <div style={{ marginTop: 8, fontSize: "0.58rem", fontFamily: "'JetBrains Mono', monospace" }}>
                <span style={{ color: wsConnected ? "#00E5A0" : "#FF4D6D" }}>
                  {wsConnected ? "● Connected to backend" : "● Backend offline — using mock"}
                </span>
              </div>
            </div>
          ) : (
            messages.map(msg => (
              <ChatBubble key={msg.id} msg={msg} onRerun={handleCommand} />
            ))
          )}

          {/* Thinking dots */}
          {isProcessing && (
            <div style={{
              display: "flex", alignItems: "flex-start", padding: "4px 12px",
              animation: "vpSlideIn 0.2s ease forwards",
            }}>
              <div style={{
                background: "#111824", border: "1px solid #1A2033",
                borderRadius: "12px 12px 12px 2px", padding: "8px 14px",
                display: "flex", alignItems: "center", gap: 6,
              }}>
                {[0, 1, 2].map(i => (
                  <div key={i} style={{
                    width: 6, height: 6, borderRadius: "50%", background: "#00D4E8",
                    animation: `vpWaveBar 1s ease-in-out infinite ${i * 0.18}s`,
                    transformOrigin: "center",
                  }} />
                ))}
              </div>
            </div>
          )}

          {/* Live interim voice transcript */}
          {isActive && liveInterim && (
            <div style={{
              display: "flex", flexDirection: "column", alignItems: "flex-end",
              padding: "4px 12px", animation: "vpSlideIn 0.2s ease forwards",
            }}>
              <div style={{
                maxWidth: "88%", background: "rgba(0,212,232,0.08)",
                border: "1px solid rgba(0,212,232,0.15)",
                borderRadius: "12px 12px 2px 12px", padding: "6px 10px",
              }}>
                <p style={{ fontSize: "0.76rem", color: "#8A9BB8", margin: 0, fontStyle: "italic", fontFamily: "'DM Sans', sans-serif" }}>
                  {liveInterim}
                  <span style={{ animation: "vpBlink 0.9s ease-in-out infinite", color: "#00D4E8", marginLeft: 2 }}>│</span>
                </p>
                {detectedIntent && detectedIntent !== "unknown" && (
                  <div style={{ marginTop: 4 }}><IntentBadge intent={detectedIntent} /></div>
                )}
              </div>
            </div>
          )}

          <div ref={chatEndRef} />
        </div>

        {/* ── Input bar ── */}
        <div style={{ flexShrink: 0, borderTop: "1px solid #111824", padding: "8px 10px", background: "#08090F" }}>
          <div style={{
            display: "flex", alignItems: "flex-end", gap: 8,
            background: "#0E111A",
            border: `1px solid ${isActive ? "rgba(0,212,232,0.4)" : "#1A2033"}`,
            borderRadius: 10, padding: "6px 8px", transition: "border-color 0.2s",
          }}>
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
                fontFamily: "'DM Sans', sans-serif", resize: "none", overflowY: "hidden",
                minHeight: 22, maxHeight: 120, padding: 0, margin: 0,
                opacity: isProcessing ? 0.5 : 1,
              }}
            />
            {isActive && (
              <div style={{ paddingBottom: 3, flexShrink: 0 }}>
                <MiniWaveform active={true} />
              </div>
            )}
            {/* Send */}
            <button
              onClick={handleTextSubmit}
              disabled={!textInput.trim() || isProcessing}
              title="Send (Enter)"
              style={{
                width: 30, height: 30, borderRadius: 7, flexShrink: 0,
                background: textInput.trim() && !isProcessing ? "#00D4E8" : "rgba(0,212,232,0.06)",
                border: `1px solid ${textInput.trim() && !isProcessing ? "#00D4E8" : "#1A2033"}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                cursor: textInput.trim() && !isProcessing ? "pointer" : "not-allowed",
                transition: "all 0.18s",
              }}
            >
              {isProcessing ? (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ animation: "vpSpin 0.8s linear infinite" }}>
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
            {/* Mic */}
            <button
              onClick={voice.toggle}
              disabled={!voice.isSupported || isProcessing}
              title={!voice.isSupported ? "Speech not supported" : isActive ? "Stop listening" : "Start voice input"}
              style={{
                width: 30, height: 30, borderRadius: 7, flexShrink: 0,
                background: isActive ? "rgba(0,212,232,0.18)" : "rgba(0,212,232,0.06)",
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
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 5, padding: "0 2px" }}>
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
