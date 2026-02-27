"use client";

import { useState, useCallback } from "react";
import { VoicePanel } from "./VoicePanel";
import { MonacoEditor, CodeAction } from "./MonacoEditor";
import { useWebSocket, WSMessage } from "../hooks/useWebSocket";
import {
  dispatchWSMessage,
  buildAgenticCommand,
  WS_URL,
  WSIncomingMsg,
  CodeActionData,
  DebugResultData,
  EditorContext,
  AICommandResponse,
} from "../services/aiService";
import { useTTS } from "../hooks/useTTS";

/* ============================================================
   TYPES
   ============================================================ */
interface FileTab {
  id: string;
  name: string;
  path: string;
  language: string;
  content: string;
  isDirty: boolean;
}

/* ============================================================
   STYLES
   ============================================================ */
const STYLES = `
  @keyframes ideFadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  .ide-layout {
    animation: ideFadeIn 0.3s ease forwards;
  }
`;

/* ============================================================
   DEFAULT FILE
   ============================================================ */
const DEFAULT_FILE: FileTab = {
  id: "main",
  name: "main.py",
  path: "/workspace/main.py",
  language: "python",
  content: `# Welcome to Senorita Voice IDE
# Speak or type commands to generate code

def hello_world():
    """A simple hello world function."""
    print("Hello from Senorita!")

if __name__ == "__main__":
    hello_world()
`,
  isDirty: false,
};

/* ============================================================
   COMPONENT
   ============================================================ */
export function IDELayout(): React.ReactElement {
  const [activeFile, setActiveFile] = useState<FileTab>(DEFAULT_FILE);
  const [pendingAction, setPendingAction] = useState<CodeAction | null>(null);
  const [cursorLine, setCursorLine] = useState(1);
  const [selection, setSelection] = useState("");
  const [debugInfo, setDebugInfo] = useState<DebugResultData | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>("");

  const tts = useTTS({ rate: 1, pitch: 1, volume: 1, lang: "en-US" });

  // WebSocket for agentic commands
  const ws = useWebSocket({
    url: WS_URL,
    autoConnect: true,
    onMessage: useCallback((msg: WSMessage) => {
      dispatchWSMessage(msg as WSIncomingMsg, {
        onIntent: (intent) => {
          setStatusMessage(`Intent: ${intent}`);
        },
        onCodeAction: (data: CodeActionData) => {
          setPendingAction(data);
          setStatusMessage(`AI suggests: ${data.action}`);
        },
        onDebugResult: (data: DebugResultData) => {
          setDebugInfo(data);
          setStatusMessage(data.summary);
          if (tts.autoSpeak && data.summary) {
            tts.speak(data.summary);
          }
        },
        onExplanation: (text) => {
          setStatusMessage(text.slice(0, 100) + "...");
          if (tts.autoSpeak && text) {
            tts.speak(text);
          }
        },
        onAgentComplete: (intent, result, text, error) => {
          if (error) {
            setStatusMessage(`Error: ${error}`);
          } else {
            setStatusMessage(`Completed: ${intent}`);
          }
        },
        onError: (message) => {
          setStatusMessage(`Error: ${message}`);
        },
      });
    }, [tts]),
  });

  // Handle voice command — send agentic command
  const handleVoiceCommand = useCallback((transcript: string) => {
    if (!ws.isConnected) {
      setStatusMessage("Not connected to backend");
      return;
    }

    const command = buildAgenticCommand({
      text: transcript,
      file_path: activeFile.path,
      cursor_line: cursorLine,
      selection: selection,
      project_root: "/workspace",
      mode: "auto",
      skip_tts: true,
    });

    ws.send(command);
    setStatusMessage("Processing...");
  }, [ws, activeFile.path, cursorLine, selection]);

  // Editor context for VoicePanel
  const editorContext: EditorContext = {
    language: activeFile.language,
    filename: activeFile.name,
    currentCode: activeFile.content,
    selectedText: selection,
    cursorLine: cursorLine,
  };

  // Handle AI response from VoicePanel (legacy path)
  const handleAIResponse = useCallback((response: AICommandResponse) => {
    if (response.code) {
      setPendingAction({
        action: response.insertMode === "replace" ? "replace_selection" : "insert",
        code: response.code,
        explanation: response.explanation,
        insert_at_line: cursorLine,
      });
    }
  }, [cursorLine]);

  // Accept code action
  const handleAcceptAction = useCallback(() => {
    if (pendingAction) {
      setStatusMessage("Changes applied");
      setPendingAction(null);
      setActiveFile(prev => ({ ...prev, isDirty: true }));
    }
  }, [pendingAction]);

  // Reject code action
  const handleRejectAction = useCallback(() => {
    setPendingAction(null);
    setStatusMessage("Changes rejected");
  }, []);

  // Editor content change
  const handleEditorChange = useCallback((value: string) => {
    setActiveFile(prev => ({
      ...prev,
      content: value,
      isDirty: true,
    }));
  }, []);

  return (
    <>
      <style>{STYLES}</style>
      <div className="ide-layout" style={{
        display: "flex", height: "100vh", width: "100vw",
        background: "#07090E", overflow: "hidden",
      }}>
        {/* Left: File Explorer (minimal) */}
        <div style={{
          width: 48, flexShrink: 0,
          background: "#0A0C14", borderRight: "1px solid #1A2033",
          display: "flex", flexDirection: "column", alignItems: "center",
          padding: "12px 0", gap: 8,
        }}>
          <div style={{
            width: 32, height: 32, borderRadius: 6,
            background: "linear-gradient(135deg, #00D4E8, #00E5A0)",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 0 12px rgba(0,212,232,0.3)",
          }}>
            <span style={{ fontSize: "0.9rem" }}>🎙</span>
          </div>
          <div style={{ flex: 1 }} />
          <div style={{
            width: 28, height: 28, borderRadius: 4,
            background: ws.isConnected ? "rgba(0,229,160,0.1)" : "rgba(255,77,109,0.1)",
            border: `1px solid ${ws.isConnected ? "rgba(0,229,160,0.3)" : "rgba(255,77,109,0.3)"}`,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <span style={{
              width: 6, height: 6, borderRadius: "50%",
              background: ws.isConnected ? "#00E5A0" : "#FF4D6D",
            }} />
          </div>
        </div>

        {/* Center: Monaco Editor */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <MonacoEditor
            value={activeFile.content}
            language={activeFile.language}
            filename={activeFile.name}
            onChange={handleEditorChange}
            onCursorChange={(line) => setCursorLine(line)}
            onSelectionChange={(sel) => setSelection(sel)}
            pendingAction={pendingAction}
            onAcceptAction={handleAcceptAction}
            onRejectAction={handleRejectAction}
          />

          {/* Status bar */}
          {statusMessage && (
            <div style={{
              padding: "6px 12px",
              background: "rgba(0,212,232,0.05)",
              borderTop: "1px solid #1A2033",
              fontSize: "0.72rem",
              color: "#8A9BB8",
              fontFamily: "'JetBrains Mono', monospace",
            }}>
              {statusMessage}
            </div>
          )}

          {/* Debug panel */}
          {debugInfo && debugInfo.bugs.length > 0 && (
            <div style={{
              maxHeight: 150, overflowY: "auto",
              background: "#0A0C14", borderTop: "1px solid #1A2033",
              padding: "8px 12px",
            }}>
              <div style={{
                fontSize: "0.68rem", color: "#FF4D6D",
                fontFamily: "'JetBrains Mono', monospace",
                marginBottom: 6, textTransform: "uppercase",
              }}>
                ● {debugInfo.bugs.length} issue{debugInfo.bugs.length > 1 ? "s" : ""} found
              </div>
              {debugInfo.bugs.map((bug, i) => (
                <div key={i} style={{
                  padding: "6px 8px", marginBottom: 4,
                  background: "rgba(255,77,109,0.05)",
                  border: "1px solid rgba(255,77,109,0.2)",
                  borderRadius: 4, fontSize: "0.72rem",
                }}>
                  <div style={{ color: "#FF4D6D", marginBottom: 2 }}>
                    Line {bug.bug_line}: {bug.bug_description}
                  </div>
                  <div style={{ color: "#8A9BB8" }}>{bug.explanation}</div>
                  {bug.fix_code && (
                    <button
                      onClick={() => setPendingAction({
                        action: "replace_selection",
                        code: bug.fix_code,
                        explanation: `Fix: ${bug.bug_description}`,
                      })}
                      style={{
                        marginTop: 4, padding: "2px 8px",
                        background: "rgba(0,229,160,0.1)",
                        border: "1px solid rgba(0,229,160,0.3)",
                        borderRadius: 3, color: "#00E5A0",
                        fontSize: "0.65rem", cursor: "pointer",
                      }}
                    >
                      Apply fix
                    </button>
                  )}
                </div>
              ))}
              <button
                onClick={() => setDebugInfo(null)}
                style={{
                  marginTop: 4, padding: "2px 8px",
                  background: "transparent",
                  border: "1px solid #1A2033",
                  borderRadius: 3, color: "#3A4560",
                  fontSize: "0.65rem", cursor: "pointer",
                }}
              >
                Dismiss
              </button>
            </div>
          )}
        </div>

        {/* Right: Voice Panel */}
        <div style={{
          width: 340, flexShrink: 0,
          borderLeft: "1px solid #1A2033",
          display: "flex", flexDirection: "column",
        }}>
          <VoicePanel
            editorContext={editorContext}
            onAIResponse={handleAIResponse}
            onTranscriptChange={handleVoiceCommand}
          />
        </div>
      </div>
    </>
  );
}

export default IDELayout;
