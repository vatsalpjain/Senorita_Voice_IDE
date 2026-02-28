"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useVoice } from "../hooks/useVoice";
import { useTTS } from "../hooks/useTTS";
import { useWakeWord } from "../hooks/useWakeWord";
import { useWebSocket, WSMessage } from "../hooks/useWebSocket";
import { useConversations, ConversationMessage } from "../hooks/useConversations";
import { ConversationSidebar } from "./ConversationSidebar";
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

export type AIMode = "Ask" | "Debug" | "Create" | "Deep Thinking";

export interface VoicePanelProps {
  editorContext: EditorContext;
  onAIResponse: (response: AICommandResponse) => void;
  onTranscriptChange?: (transcript: string) => void;
  onCodeAction?: (action: CodeActionData) => void;
  onSummarize?: (messages: ChatMessage[], codeChanges: CodeChange[]) => void;
  onModeChange?: (mode: AIMode) => void;
  onOpenFile?: (filename: string) => void;
  injectCodeRef?: React.MutableRefObject<((code: string) => void) | null>;
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
  
  /* Subtle scrollbar for textarea */
  .vp-textarea-scroll::-webkit-scrollbar {
    width: 4px;
  }
  .vp-textarea-scroll::-webkit-scrollbar-track {
    background: transparent;
  }
  .vp-textarea-scroll::-webkit-scrollbar-thumb {
    background: rgba(0,212,232,0.25);
    border-radius: 4px;
  }
  .vp-textarea-scroll::-webkit-scrollbar-thumb:hover {
    background: rgba(0,212,232,0.4);
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
      fontSize: "0.66rem", fontFamily: "'JetBrains Mono', monospace",
      padding: "1px 6px", borderRadius: 100,
      letterSpacing: "0.06em", textTransform: "uppercase", flexShrink: 0,
    }}>
      {intent}
    </span>
  );
}

/* ============================================================
   MODE DROPUP
   ============================================================ */
const MODE_CONFIG: Record<AIMode, { icon: string; color: string; bg: string }> = {
  "Ask": { icon: "✦", color: "#00D4E8", bg: "rgba(0,212,232,0.1)" },
  "Debug": { icon: "⚡", color: "#fbbf24", bg: "rgba(251,191,36,0.1)" },
  "Create": { icon: "✚", color: "#4ade80", bg: "rgba(74,222,128,0.1)" },
  "Deep Thinking": { icon: "◈", color: "#a78bfa", bg: "rgba(139,92,246,0.1)" },
};

function ModeDropup({ mode, onModeChange }: { mode: AIMode; onModeChange: (m: AIMode) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const cfg = MODE_CONFIG[mode];

  // Close on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      {/* Trigger button */}
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: "flex", alignItems: "center", gap: 5,
          background: cfg.bg,
          border: "none",
          borderRadius: 5,
          padding: "4px 10px",
          color: cfg.color,
          fontSize: "0.88rem",
          fontFamily: "'JetBrains Mono', monospace",
          cursor: "pointer",
          transition: "all 0.15s",
        }}
      >
        <span>{cfg.icon}</span>
        <span>{mode}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" 
          stroke={cfg.color} strokeWidth="1.5" strokeLinecap="round"
          style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.15s" }}>
          <polyline points="2,6 5,3 8,6" />
        </svg>
      </button>

      {/* Dropup menu */}
      {open && (
        <div style={{
          position: "absolute",
          bottom: "calc(100% + 6px)",
          left: 0,
          background: "#0E111A",
          border: "1px solid #1A2033",
          borderRadius: 8,
          padding: "4px",
          minWidth: 140,
          boxShadow: "0 -4px 20px rgba(0,0,0,0.4)",
          zIndex: 100,
          animation: "vpSlideIn 0.15s ease forwards",
        }}>
          {(Object.keys(MODE_CONFIG) as AIMode[]).map((m) => {
            const c = MODE_CONFIG[m];
            const isActive = m === mode;
            return (
              <button
                key={m}
                onClick={() => { onModeChange(m); setOpen(false); }}
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  width: "100%",
                  background: isActive ? c.bg : "transparent",
                  border: "none",
                  borderRadius: 5,
                  padding: "7px 10px",
                  color: isActive ? c.color : "#8A9BB8",
                  fontSize: "0.88rem",
                  fontFamily: "'JetBrains Mono', monospace",
                  cursor: "pointer",
                  transition: "all 0.12s",
                  textAlign: "left",
                }}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.background = "rgba(255,255,255,0.03)";
                    e.currentTarget.style.color = c.color;
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.background = "transparent";
                    e.currentTarget.style.color = "#8A9BB8";
                  }
                }}
              >
                <span style={{ color: c.color }}>{c.icon}</span>
                <span>{m}</span>
                {isActive && (
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" 
                    stroke={c.color} strokeWidth="1.8" strokeLinecap="round" style={{ marginLeft: "auto" }}>
                    <polyline points="2,5 4,7 8,3" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
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
          fontSize: "0.93rem", lineHeight: 1.55, margin: 0,
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
                color: "#3A4560", fontSize: "0.82rem",
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
                padding: "8px 10px", fontSize: "0.88rem", color: "#4DD9E8",
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
          <div style={{ marginTop: 6, fontSize: "0.68rem", color: "#2A3555", fontFamily: "'JetBrains Mono', monospace" }}>
            mock · backend offline
          </div>
        )}
      </div>

      {/* Timestamp + re-run */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 3, paddingRight: isUser ? 2 : 0, paddingLeft: isUser ? 0 : 2 }}>
        <span style={{ fontSize: "0.68rem", color: "#2A3555", fontFamily: "'JetBrains Mono', monospace" }}>{ts}</span>
        {isUser && (
          <button
            onClick={() => onRerun(msg.text)}
            style={{ background: "none", border: "none", color: "#2A3555", fontSize: "0.7rem", cursor: "pointer", fontFamily: "'JetBrains Mono', monospace", padding: 0, transition: "color 0.15s" }}
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
// Activity/thinking status type
type ActivityStatus = "idle" | "thinking" | "reading" | "searching" | "generating" | "editing";

interface ActivityState {
  status: ActivityStatus;
  message: string;
  files: string[]; // Files being read/edited
}

export function VoicePanel({
  editorContext,
  onAIResponse,
  onTranscriptChange,
  injectCodeRef,
  onCodeAction,
  onSummarize,
  onModeChange,
  onOpenFile,
}: VoicePanelProps): React.ReactElement {
  // Conversation management with localStorage persistence
  const conversations = useConversations();
  const [showConversationList, setShowConversationList] = useState(false);
  
  // Map ConversationMessage to ChatMessage for compatibility
  const messages: ChatMessage[] = conversations.messages.map(m => ({
    ...m,
    timestamp: m.timestamp instanceof Date ? m.timestamp : new Date(m.timestamp),
  }));
  
  const setMessages = useCallback((updater: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
    if (typeof updater === "function") {
      conversations.setMessages((prev: ConversationMessage[]) => {
        const mapped = prev.map(m => ({ ...m, timestamp: m.timestamp instanceof Date ? m.timestamp : new Date(m.timestamp) }));
        return updater(mapped as ChatMessage[]);
      });
    } else {
      conversations.setMessages(updater);
    }
  }, [conversations]);
  
  const [textInput, setTextInput]       = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [codeChanges, setCodeChanges]   = useState<CodeChange[]>([]);
  const [mode, setMode]                 = useState<AIMode>("Ask");
  
  // Activity/thinking state
  const [activity, setActivity] = useState<ActivityState>({ status: "idle", message: "", files: [] });
  
  // Context files (current file + any mentioned/edited files)
  const [contextFiles, setContextFiles] = useState<Array<{ name: string; tokens: number; isEdited?: boolean }>>([]);

  const handleModeChange = (m: AIMode) => {
    setMode(m);
    onModeChange?.(m);
  };

  const chatEndRef      = useRef<HTMLDivElement>(null);
  const textareaRef     = useRef<HTMLTextAreaElement>(null);

  // Wire up injectCodeRef so parent can push code into the input
  useEffect(() => {
    if (injectCodeRef) {
      injectCodeRef.current = (code: string) => {
        const snippet = `\`\`\`\n${code}\n\`\`\`\n`;
        setTextInput(prev => snippet + (prev ? "\n" + prev : ""));
        setTimeout(() => {
          const el = textareaRef.current;
          if (el) {
            el.focus();
            el.style.height = "auto";
            el.style.height = Math.min(el.scrollHeight, 120) + "px";
            el.setSelectionRange(el.value.length, el.value.length);
          }
        }, 50);
      };
    }
  }, [injectCodeRef]);
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

  /* ── Update context files from editor context ── */
  useEffect(() => {
    if (editorContext.filename) {
      // Estimate tokens (~4 chars per token)
      const tokens = Math.ceil((editorContext.currentCode?.length || 0) / 4);
      setContextFiles(prev => {
        const existing = prev.find(f => f.name === editorContext.filename);
        if (existing) {
          return prev.map(f => f.name === editorContext.filename ? { ...f, tokens } : f);
        }
        return [{ name: editorContext.filename, tokens, isEdited: false }];
      });
    }
  }, [editorContext.filename, editorContext.currentCode]);

  /* ── TTS ── */
  const tts = useTTS({ rate: 1, pitch: 1, volume: 1, lang: "en-US" });

  /* ── WebSocket connection ── */
  const ws = useWebSocket({
    url: WS_URL,
    autoConnect: true,
    onMessage: useCallback((msg: WSMessage) => {
      console.log("[VoicePanel] WS message received:", msg);
      dispatchWSMessage(msg as WSIncomingMsg, {
        onAction: (action, _param) => {
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
          setActivity({ status: "generating", message: "Generating response...", files: [] });
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
          setActivity({ status: "idle", message: "", files: [] });
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
          setActivity({ status: "idle", message: "", files: [] });
          streamBubbleId.current = null;
          streamChunks.current = [];
        },

        // Activity status callback (real-time file reading/searching updates)
        onActivity: (status, message, files) => {
          console.log("[VoicePanel] onActivity:", status, message, files);
          setActivity({
            status: status as ActivityStatus,
            message,
            files,
          });
          // Also add files to context if they're being read
          if (status === "reading" || status === "generating") {
            setContextFiles(prev => {
              const newFiles = files.filter(f => !prev.some(p => p.name.endsWith(f)));
              if (newFiles.length === 0) return prev;
              return [
                ...prev,
                ...newFiles.map(f => ({ name: f, tokens: 0, isEdited: false })),
              ];
            });
          } else if (status === "done") {
            // Clear activity when backend signals completion
            setActivity({ status: "idle", message: "", files: [] });
          }
        },

        // Agentic workflow callbacks
        onIntent: (intent) => {
          console.log("[VoicePanel] onIntent:", intent);
          setActivity({ status: "thinking", message: `Processing ${intent}...`, files: [] });
          // Create streaming bubble for agentic response - start with empty text
          // The actual text will be filled by onExplanation or onAgentComplete
          const bubbleId = `a-${Date.now()}`;
          streamBubbleId.current = bubbleId;
          streamChunks.current = [];
          const streamingMsg: ChatMessage = {
            id: bubbleId,
            role: "assistant",
            text: "",  // Start empty - will be filled by subsequent callbacks
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

        onExplanation: (data) => {
          const text = data?.text || "";
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
          
          // Auto-open referenced files if any
          if (data?.files_to_open && data.files_to_open.length > 0) {
            console.log("[VoicePanel] Files to open:", data.files_to_open);
            // Dispatch event for editor to open these files
            window.dispatchEvent(new CustomEvent("senorita:open-files", {
              detail: { files: data.files_to_open }
            }));
          }
        },

        onAgentComplete: async (intent, result, text) => {
          console.log("[VoicePanel] onAgentComplete:", { intent, text: text?.substring(0, 100), result });
          
          // Build final text - use text from response, or extract from result data
          let finalText = text || "";
          if (!finalText && result && typeof result === "object" && result !== null) {
            // Try to extract meaningful text from result data
            const resultObj = result as { data?: Record<string, unknown> };
            if (resultObj.data) {
              const data = resultObj.data;
              finalText = (data.explanation as string) || 
                         (data.summary as string) || 
                         (data.message as string) || 
                         (data.text as string) ||
                         (data.response as string) ||
                         "";
            }
          }
          
          // If still no text, make a summarization API call
          if (!finalText) {
            console.log("[VoicePanel] No response text, making summary call...");
            try {
              const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
              const summaryRes = await fetch(`${API_BASE}/api/summarize-result`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  intent,
                  result: result,
                  context: editorContext.filename || "code",
                }),
              });
              if (summaryRes.ok) {
                const summaryData = await summaryRes.json();
                finalText = summaryData.summary || summaryData.text || "Task completed.";
              } else {
                finalText = `Completed ${intent} task.`;
              }
            } catch (err) {
              console.error("[VoicePanel] Summary call failed:", err);
              finalText = `Completed ${intent} task.`;
            }
          }
          
          // Finalize agentic response
          setMessages(prev =>
            prev.map(m =>
              m.id === streamBubbleId.current
                ? { ...m, text: finalText, intent, isStreaming: false }
                : m
            )
          );
          setIsProcessing(false);
          setActivity({ status: "idle", message: "", files: [] }); // Clear activity state
          streamBubbleId.current = null;

          // Auto-speak via Web Speech TTS
          if (tts.autoSpeak && tts.isSupported && finalText) {
            tts.speak(finalText);
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
        console.log("[VoicePanel] Sending agentic_command with file_content length:", editorContext.currentCode?.length || 0, "project_root:", editorContext.projectRoot);
        const agenticCmd = buildAgenticCommand({
          text: trimmed,
          file_path: editorContext.filename,
          file_content: editorContext.currentCode || "",
          cursor_line: editorContext.cursorLine || 1,
          selection: editorContext.selection || "",
          project_root: editorContext.projectRoot || "",
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

  /* ── Wake word detection state ── */
  const [wakeWordEnabled, setWakeWordEnabled] = useState(false);

  // Ref to hold voice.startListening to avoid dependency issues
  const voiceStartListeningRef = useRef(voice.startListening);
  voiceStartListeningRef.current = voice.startListening;

  /* ── Wake word hook ── */
  const wakeWord = useWakeWord({
    enabled: wakeWordEnabled,
    threshold: 0.5,
    onDetected: useCallback((confidence: number) => {
      console.log(`[VoicePanel] Wake word detected! Confidence: ${confidence}`);
      // Start voice listening when wake word is detected
      voiceStartListeningRef.current();
    }, []),
    onError: useCallback((err: string) => {
      console.error("[VoicePanel] Wake word error:", err);
    }, []),
  });

  // Pause wake word detection while voice is active or processing
  // Using refs to avoid dependency issues
  const wakeWordPauseRef = useRef(wakeWord.pause);
  const wakeWordResumeRef = useRef(wakeWord.resume);
  wakeWordPauseRef.current = wakeWord.pause;
  wakeWordResumeRef.current = wakeWord.resume;

  useEffect(() => {
    if (wakeWordEnabled) {
      if (voice.status === "listening" || voice.status === "requesting" || isProcessing) {
        wakeWordPauseRef.current();
      } else {
        wakeWordResumeRef.current();
      }
    }
  }, [voice.status, isProcessing, wakeWordEnabled]);

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
        overflow: "hidden", position: "relative",
      }}>

        {/* ── Panel header ── */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "0 12px", height: 36,
          borderBottom: "1px solid #111824", flexShrink: 0,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <span style={{
              fontSize: "0.68rem", letterSpacing: "0.1em", textTransform: "uppercase",
              fontFamily: "'JetBrains Mono', monospace", color: "#5A6888",
            }}>AI Assistant</span>
            {(isActive || isProcessing) && (
              <span style={{
                fontSize: "0.68rem", fontFamily: "'JetBrains Mono', monospace",
                color: isActive ? "#00D4E8" : "#F6C90E",
                transition: "color 0.3s",
              }}>
                {isActive ? "Listening…" : "Thinking…"}
              </span>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {/* New conversation button */}
            <button
              onClick={() => conversations.createConversation(editorContext.projectRoot)}
              title="New conversation"
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 22, height: 22,
                background: "rgba(0,212,232,0.08)",
                border: "1px solid rgba(0,212,232,0.2)",
                borderRadius: 4, cursor: "pointer",
                transition: "all 0.15s",
              }}
              onMouseEnter={e => { e.currentTarget.style.background = "rgba(0,212,232,0.15)"; e.currentTarget.style.borderColor = "rgba(0,212,232,0.35)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "rgba(0,212,232,0.08)"; e.currentTarget.style.borderColor = "rgba(0,212,232,0.2)"; }}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="#00D4E8" strokeWidth="1.6" strokeLinecap="round">
                <line x1="6" y1="2" x2="6" y2="10" />
                <line x1="2" y1="6" x2="10" y2="6" />
              </svg>
            </button>
            
            {/* History button */}
            <button
              onClick={() => setShowConversationList(true)}
              title="Conversation history"
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 22, height: 22,
                background: showConversationList ? "rgba(139,92,246,0.15)" : "transparent",
                border: `1px solid ${showConversationList ? "rgba(139,92,246,0.3)" : "#1A2033"}`,
                borderRadius: 4, cursor: "pointer",
                transition: "all 0.15s",
              }}
              onMouseEnter={e => { e.currentTarget.style.background = "rgba(139,92,246,0.12)"; e.currentTarget.style.borderColor = "rgba(139,92,246,0.25)"; }}
              onMouseLeave={e => { if (!showConversationList) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = "#1A2033"; }}}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke={showConversationList ? "#A78BFA" : "#5A6888"} strokeWidth="1.3" strokeLinecap="round">
                <circle cx="6" cy="6" r="4.5" />
                <polyline points="6,3.5 6,6 8,7" />
              </svg>
            </button>
            
            {/* Conversation count badge */}
            {conversations.conversations.length > 0 && (
              <span style={{
                fontSize: "0.6rem", fontFamily: "'JetBrains Mono', monospace",
                color: "#3A4560", marginLeft: -4,
              }}>
                {conversations.conversations.length}
              </span>
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
                  fontSize: "0.66rem", padding: "2px 7px",
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

            {/* Clear - trash icon */}
            {messages.length > 0 && (
              <button
                onClick={() => { setMessages([]); tts.stop(); }}
                title="Clear conversation"
                style={{
                  background: "none", border: "1px solid #1A2033",
                  color: "#2A3555", padding: "3px 5px",
                  borderRadius: 3, cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  transition: "all 0.15s",
                }}
                onMouseEnter={e => { e.currentTarget.style.color = "#FF4D6D"; e.currentTarget.style.borderColor = "rgba(255,77,109,0.3)"; }}
                onMouseLeave={e => { e.currentTarget.style.color = "#2A3555"; e.currentTarget.style.borderColor = "#1A2033"; }}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
                  <path d="M2 3h8M4 3V2a1 1 0 011-1h2a1 1 0 011 1v1M9 3v7a1 1 0 01-1 1H4a1 1 0 01-1-1V3" />
                  <line x1="5" y1="5.5" x2="5" y2="8.5" />
                  <line x1="7" y1="5.5" x2="7" y2="8.5" />
                </svg>
              </button>
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
              <p style={{ fontSize: "0.82rem", color: "#3A4560", margin: 0 }}>Ask anything about your code</p>
              <div style={{ fontSize: "0.75rem", color: "#2A3555", lineHeight: 1.6 }}>
                <span style={{ color: "#4DD9E8" }}>&quot;generate a fetch helper&quot;</span><br />
                <span style={{ color: "#4DD9E8" }}>&quot;refactor this to async/await&quot;</span><br />
                <span style={{ color: "#4DD9E8" }}>&quot;open page.tsx and explain it&quot;</span>
              </div>
              <div style={{ marginTop: 8, fontSize: "0.66rem", fontFamily: "'JetBrains Mono', monospace" }}>
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
                <p style={{ fontSize: "0.82rem", color: "#8A9BB8", margin: 0, fontStyle: "italic", fontFamily: "'DM Sans', sans-serif" }}>
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
        <div style={{ flexShrink: 0, borderTop: "1px solid #111824", padding: "8px 10px", background: "#08090F", position: "relative" }}>
          
          {/* Thinking/Activity box - shows when processing */}
          {(isProcessing || activity.status !== "idle") && (
            <div style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "6px 10px", marginBottom: 6,
              background: "rgba(139,92,246,0.06)",
              border: "1px solid rgba(139,92,246,0.15)",
              borderRadius: 8,
              animation: "vpSlideIn 0.15s ease forwards",
            }}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" 
                style={{ animation: "vpSpin 1.5s linear infinite", flexShrink: 0 }}>
                <circle cx="7" cy="7" r="5.5" stroke="rgba(139,92,246,0.6)" strokeWidth="1.5" strokeDasharray="20 12" />
              </svg>
              <span style={{ 
                fontSize: "0.75rem", color: "#A78BFA", 
                fontFamily: "'JetBrains Mono', monospace",
              }}>
                {activity.status === "reading" ? `Reading ${activity.files.join(", ")}...` :
                 activity.status === "searching" ? "Searching codebase..." :
                 activity.status === "generating" ? "Generating response..." :
                 activity.status === "editing" ? `Editing ${activity.files.join(", ")}...` :
                 "Thinking..."}
              </span>
              {activity.files.length > 0 && (
                <div style={{ display: "flex", gap: 4, marginLeft: "auto" }}>
                  {activity.files.slice(0, 2).map((f, i) => (
                    <span key={i} style={{
                      fontSize: "0.68rem", color: "#8B5CF6",
                      background: "rgba(139,92,246,0.15)",
                      padding: "1px 6px", borderRadius: 4,
                      fontFamily: "'JetBrains Mono', monospace",
                    }}>
                      {f.split("/").pop()}
                    </span>
                  ))}
                  {activity.files.length > 2 && (
                    <span style={{ fontSize: "0.68rem", color: "#6D28D9" }}>+{activity.files.length - 2}</span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Context files pills - shows current file and edited files */}
          {contextFiles.length > 0 && (
            <div style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "4px 8px", marginBottom: 6,
              overflowX: "auto",
            }}>
              {contextFiles.map((file, i) => (
                <div
                  key={i}
                  onClick={() => onOpenFile?.(file.name)}
                  style={{
                    display: "flex", alignItems: "center", gap: 4,
                    background: file.isEdited ? "rgba(74,222,128,0.1)" : "rgba(0,212,232,0.08)",
                    border: `1px solid ${file.isEdited ? "rgba(74,222,128,0.25)" : "rgba(0,212,232,0.2)"}`,
                    borderRadius: 5,
                    padding: "2px 8px",
                    flexShrink: 0,
                    cursor: "pointer",
                    transition: "all 0.15s",
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.background = file.isEdited ? "rgba(74,222,128,0.18)" : "rgba(0,212,232,0.15)";
                    e.currentTarget.style.borderColor = file.isEdited ? "rgba(74,222,128,0.4)" : "rgba(0,212,232,0.35)";
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = file.isEdited ? "rgba(74,222,128,0.1)" : "rgba(0,212,232,0.08)";
                    e.currentTarget.style.borderColor = file.isEdited ? "rgba(74,222,128,0.25)" : "rgba(0,212,232,0.2)";
                  }}
                  title={`Click to open ${file.name}`}
                >
                  <span style={{ 
                    fontSize: "0.72rem", 
                    color: file.isEdited ? "#4ade80" : "#00D4E8",
                    fontFamily: "'JetBrains Mono', monospace",
                  }}>
                    @{file.name.split("/").pop()?.split("\\").pop()}
                  </span>
                  <span style={{
                    fontSize: "0.62rem", color: "#3A4560",
                    fontFamily: "'JetBrains Mono', monospace",
                  }}>
                    {file.tokens > 1000 ? `${(file.tokens / 1000).toFixed(1)}k` : file.tokens}
                  </span>
                  {file.isEdited && (
                    <span style={{ fontSize: "0.6rem", color: "#4ade80" }}>●</span>
                  )}
                  <span
                    onClick={(e) => { e.stopPropagation(); setContextFiles(prev => prev.filter((_, idx) => idx !== i)); }}
                    style={{ 
                      fontSize: "0.65rem", color: "#2A3555", cursor: "pointer",
                      marginLeft: 2, transition: "color 0.15s",
                    }}
                    onMouseEnter={e => (e.currentTarget.style.color = "#FF4D6D")}
                    onMouseLeave={e => (e.currentTarget.style.color = "#2A3555")}
                  >✕</span>
                </div>
              ))}
            </div>
          )}

          {/* Main input container */}
          <div style={{
            display: "flex", flexDirection: "column",
            background: "#0E111A",
            border: `1px solid ${isActive ? "rgba(0,212,232,0.4)" : "#1A2033"}`,
            borderRadius: 10, transition: "border-color 0.2s",
          }}>
            {/* Textarea row */}
            <div style={{ display: "flex", alignItems: "flex-end", gap: 8, padding: "10px 10px 6px 10px" }}>
              <textarea
                ref={textareaRef}
                value={textInput}
                onChange={e => { setTextInput(e.target.value); autoGrow(); }}
                onKeyDown={handleKeyDown}
                placeholder={voice.isSupported ? "Ask anything (Ctrl+L)" : "Type a command…"}
                disabled={isProcessing}
                rows={1}
                className="vp-textarea-scroll"
                style={{
                  flex: 1, background: "transparent", border: "none", outline: "none",
                  color: "#C8D5E8", fontSize: "0.88rem", lineHeight: 1.5,
                  fontFamily: "'DM Sans', sans-serif", resize: "none", overflowY: "auto",
                  minHeight: 22, maxHeight: 120, padding: 0, margin: 0,
                  opacity: isProcessing ? 0.5 : 1,
                }}
              />
              {isActive && (
                <div style={{ paddingBottom: 3, flexShrink: 0 }}>
                  <MiniWaveform active={true} />
                </div>
              )}
            </div>
            
            {/* Bottom bar with mode selector and buttons */}
            <div style={{ 
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "6px 8px", borderTop: "1px solid #1A2033",
            }}>
              {/* Left side - Mode dropup + toggles */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, position: "relative" }}>
                <ModeDropup mode={mode} onModeChange={handleModeChange} />
                
                {/* Voice toggle (TTS) */}
                {tts.isSupported && (
                  <div
                    onClick={() => { tts.setAutoSpeak(!tts.autoSpeak); if (tts.isSpeaking) tts.stop(); }}
                    title={tts.autoSpeak ? "Voice ON" : "Voice OFF"}
                    style={{
                      display: "flex", alignItems: "center", gap: 4,
                      cursor: "pointer", userSelect: "none",
                      padding: "3px 6px", borderRadius: 4,
                      background: tts.autoSpeak ? "rgba(0,229,160,0.1)" : "transparent",
                      border: `1px solid ${tts.autoSpeak ? "rgba(0,229,160,0.3)" : "transparent"}`,
                      transition: "all 0.15s",
                    }}
                  >
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" 
                      stroke={tts.autoSpeak ? "#00E5A0" : "#3A4560"} strokeWidth="1.3" strokeLinecap="round">
                      <path d="M1 4.5v3h2l3 2.5v-8L3 4.5H1z" />
                      {tts.autoSpeak && <path d="M8 4c.5.5.8 1.2.8 2s-.3 1.5-.8 2M9.5 2.5c1 1 1.5 2.2 1.5 3.5s-.5 2.5-1.5 3.5" />}
                    </svg>
                  </div>
                )}
                
                {/* Wake word toggle */}
                <div
                  onClick={() => setWakeWordEnabled(!wakeWordEnabled)}
                  title={wakeWordEnabled ? 'Wake word ON — say "Senorita"' : "Wake word OFF"}
                  style={{
                    display: "flex", alignItems: "center", gap: 4,
                    cursor: "pointer", userSelect: "none",
                    padding: "3px 6px", borderRadius: 4,
                    background: wakeWordEnabled ? "rgba(0,212,232,0.1)" : "transparent",
                    border: `1px solid ${wakeWordEnabled ? "rgba(0,212,232,0.3)" : "transparent"}`,
                    transition: "all 0.15s",
                  }}
                >
                  <span style={{
                    fontSize: "0.7rem", fontFamily: "'JetBrains Mono', monospace",
                    color: wakeWordEnabled ? "#00D4E8" : "#3A4560",
                  }}>
                    {wakeWord.status === "listening" ? "🎤" : "💤"}
                  </span>
                </div>
              </div>
              
              {/* Right side - Action buttons */}
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {/* Mic */}
                <button
                  onClick={voice.toggle}
                  disabled={!voice.isSupported || isProcessing}
                  title={!voice.isSupported ? "Speech not supported" : isActive ? "Stop listening" : "Start voice input"}
                  style={{
                    width: 28, height: 28, borderRadius: 6, flexShrink: 0,
                    background: isActive ? "rgba(0,212,232,0.18)" : "transparent",
                    border: "none",
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
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"
                      stroke="#5A6888" strokeWidth="1.5" strokeLinecap="round">
                      <rect x="5" y="1.5" width="6" height="8" rx="3" />
                      <path d="M2.5 8a5.5 5.5 0 0 0 11 0" />
                      <line x1="8" y1="13" x2="8" y2="14.5" />
                    </svg>
                  )}
                </button>
                {/* Send */}
                <button
                  onClick={handleTextSubmit}
                  disabled={!textInput.trim() || isProcessing}
                  title="Send (Enter)"
                  style={{
                    width: 28, height: 28, borderRadius: 6, flexShrink: 0,
                    background: textInput.trim() && !isProcessing ? "#00D4E8" : "transparent",
                    border: "none",
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
                      stroke={textInput.trim() ? "#07090E" : "#3A4560"} strokeWidth="1.8"
                      strokeLinecap="round" strokeLinejoin="round">
                      <line x1="7" y1="12" x2="7" y2="2" />
                      <polyline points="3,6 7,2 11,6" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      {/* Conversation Sidebar */}
      <ConversationSidebar
        conversations={conversations.conversations}
        activeId={conversations.activeId}
        onSelect={(id) => {
          conversations.switchConversation(id);
          setShowConversationList(false);
        }}
        onNew={() => {
          conversations.createConversation(editorContext.projectRoot);
          setShowConversationList(false);
        }}
        onDelete={conversations.deleteConversation}
        onRename={conversations.renameConversation}
        isOpen={showConversationList}
        onClose={() => setShowConversationList(false)}
      />
    </>
  );
}
