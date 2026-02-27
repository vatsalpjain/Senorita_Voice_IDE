"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import Editor, { Monaco, OnMount } from "@monaco-editor/react";
import type { editor } from "monaco-editor";

/* ============================================================
   TYPES
   ============================================================ */
export interface CodeAction {
  action: "insert" | "replace_selection" | "replace_file" | "create_file" | "delete_lines";
  code: string;
  filename?: string;
  insert_at_line?: number;
  start_line?: number;
  end_line?: number;
  explanation?: string;
}

export interface MonacoEditorProps {
  value: string;
  language: string;
  filename: string;
  onChange?: (value: string) => void;
  onCursorChange?: (line: number, column: number) => void;
  onSelectionChange?: (selection: string) => void;
  pendingAction?: CodeAction | null;
  onAcceptAction?: () => void;
  onRejectAction?: () => void;
  readOnly?: boolean;
}

/* ============================================================
   THEME CONFIG
   ============================================================ */
const SENORITA_THEME: editor.IStandaloneThemeData = {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "comment", foreground: "3A4560", fontStyle: "italic" },
    { token: "keyword", foreground: "00D4E8" },
    { token: "string", foreground: "00E5A0" },
    { token: "number", foreground: "F6C90E" },
    { token: "type", foreground: "4DD9E8" },
    { token: "function", foreground: "C8D5E8" },
    { token: "variable", foreground: "8A9BB8" },
  ],
  colors: {
    "editor.background": "#08090F",
    "editor.foreground": "#C8D5E8",
    "editor.lineHighlightBackground": "#0E1118",
    "editor.selectionBackground": "#1A3050",
    "editorLineNumber.foreground": "#2A3555",
    "editorLineNumber.activeForeground": "#00D4E8",
    "editorCursor.foreground": "#00D4E8",
    "editor.selectionHighlightBackground": "#1A3050",
    "editorIndentGuide.background": "#1A2033",
    "editorIndentGuide.activeBackground": "#2A3555",
  },
};

/* ============================================================
   STYLES
   ============================================================ */
const STYLES = `
  @keyframes meSlideIn {
    from { opacity: 0; transform: translateY(-8px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes mePulse {
    0%, 100% { box-shadow: 0 0 0 0 rgba(0,212,232,0.4); }
    50% { box-shadow: 0 0 0 6px rgba(0,212,232,0); }
  }
  .me-action-bar {
    animation: meSlideIn 0.2s ease forwards;
  }
  .me-accept-btn:hover {
    background: rgba(0,229,160,0.2) !important;
    border-color: #00E5A0 !important;
  }
  .me-reject-btn:hover {
    background: rgba(255,77,109,0.2) !important;
    border-color: #FF4D6D !important;
  }
`;

/* ============================================================
   COMPONENT
   ============================================================ */
export function MonacoEditor({
  value,
  language,
  filename,
  onChange,
  onCursorChange,
  onSelectionChange,
  pendingAction,
  onAcceptAction,
  onRejectAction,
  readOnly = false,
}: MonacoEditorProps): React.ReactElement {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const [previewValue, setPreviewValue] = useState<string | null>(null);
  const decorationsRef = useRef<string[]>([]);

  const handleEditorMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    // Register custom theme
    monaco.editor.defineTheme("senorita", SENORITA_THEME);
    monaco.editor.setTheme("senorita");

    // Cursor position tracking
    editor.onDidChangeCursorPosition((e) => {
      onCursorChange?.(e.position.lineNumber, e.position.column);
    });

    // Selection tracking
    editor.onDidChangeCursorSelection((e) => {
      const selection = editor.getModel()?.getValueInRange(e.selection);
      onSelectionChange?.(selection || "");
    });
  }, [onCursorChange, onSelectionChange]);

  const handleChange = useCallback((val: string | undefined) => {
    if (val !== undefined && !previewValue) {
      onChange?.(val);
    }
  }, [onChange, previewValue]);

  // Apply pending action preview
  useEffect(() => {
    if (!pendingAction || !editorRef.current || !monacoRef.current) {
      setPreviewValue(null);
      // Clear decorations
      if (editorRef.current) {
        decorationsRef.current = editorRef.current.deltaDecorations(decorationsRef.current, []);
      }
      return;
    }

    const editor = editorRef.current;
    const monaco = monacoRef.current;
    const model = editor.getModel();
    if (!model) return;

    let newValue = value;
    let highlightStart = 1;
    let highlightEnd = 1;

    switch (pendingAction.action) {
      case "insert": {
        const line = pendingAction.insert_at_line || 1;
        const lines = value.split("\n");
        lines.splice(line - 1, 0, pendingAction.code);
        newValue = lines.join("\n");
        highlightStart = line;
        highlightEnd = line + pendingAction.code.split("\n").length - 1;
        break;
      }
      case "replace_selection": {
        const selection = editor.getSelection();
        if (selection) {
          newValue = model.getValueInRange(new monaco.Range(1, 1, selection.startLineNumber, selection.startColumn))
            + pendingAction.code
            + model.getValueInRange(new monaco.Range(selection.endLineNumber, selection.endColumn, model.getLineCount(), model.getLineMaxColumn(model.getLineCount())));
          highlightStart = selection.startLineNumber;
          highlightEnd = selection.startLineNumber + pendingAction.code.split("\n").length - 1;
        }
        break;
      }
      case "replace_file": {
        newValue = pendingAction.code;
        highlightStart = 1;
        highlightEnd = pendingAction.code.split("\n").length;
        break;
      }
      case "delete_lines": {
        const start = pendingAction.start_line || 1;
        const end = pendingAction.end_line || start;
        const lines = value.split("\n");
        lines.splice(start - 1, end - start + 1);
        newValue = lines.join("\n");
        highlightStart = start;
        highlightEnd = start;
        break;
      }
      default:
        break;
    }

    setPreviewValue(newValue);

    // Add highlight decorations for changed lines
    const decorations: editor.IModelDeltaDecoration[] = [];
    for (let i = highlightStart; i <= highlightEnd; i++) {
      decorations.push({
        range: new monaco.Range(i, 1, i, 1),
        options: {
          isWholeLine: true,
          className: "line-insert-highlight",
          glyphMarginClassName: "glyph-insert",
          linesDecorationsClassName: "line-decoration-insert",
        },
      });
    }

    // Apply decorations after a short delay to let the editor update
    setTimeout(() => {
      if (editorRef.current) {
        decorationsRef.current = editorRef.current.deltaDecorations(decorationsRef.current, decorations);
      }
    }, 50);
  }, [pendingAction, value]);

  const handleAccept = useCallback(() => {
    if (previewValue !== null) {
      onChange?.(previewValue);
      setPreviewValue(null);
      decorationsRef.current = editorRef.current?.deltaDecorations(decorationsRef.current, []) || [];
      onAcceptAction?.();
    }
  }, [previewValue, onChange, onAcceptAction]);

  const handleReject = useCallback(() => {
    setPreviewValue(null);
    decorationsRef.current = editorRef.current?.deltaDecorations(decorationsRef.current, []) || [];
    onRejectAction?.();
  }, [onRejectAction]);

  // Get cursor position for context
  const getCursorLine = useCallback((): number => {
    return editorRef.current?.getPosition()?.lineNumber || 1;
  }, []);

  const getSelection = useCallback((): string => {
    const editor = editorRef.current;
    if (!editor) return "";
    const selection = editor.getSelection();
    if (!selection) return "";
    return editor.getModel()?.getValueInRange(selection) || "";
  }, []);

  return (
    <>
      <style>{STYLES}</style>
      <style>{`
        .line-insert-highlight {
          background: rgba(0, 229, 160, 0.1) !important;
        }
        .glyph-insert {
          background: #00E5A0;
          width: 3px !important;
          margin-left: 3px;
        }
        .line-decoration-insert {
          background: linear-gradient(90deg, rgba(0,229,160,0.3) 0%, transparent 100%);
          width: 5px !important;
        }
      `}</style>

      <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#08090F" }}>
        {/* File tab bar */}
        <div style={{
          display: "flex", alignItems: "center", height: 32,
          background: "#0A0C14", borderBottom: "1px solid #1A2033",
          padding: "0 8px", gap: 4,
        }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 6,
            background: "#08090F", border: "1px solid #1A2033",
            borderBottom: "1px solid #08090F",
            padding: "4px 12px", borderRadius: "4px 4px 0 0",
            marginBottom: -1,
          }}>
            <span style={{ color: "#00D4E8", fontSize: "0.7rem" }}>⬡</span>
            <span style={{ color: "#C8D5E8", fontSize: "0.75rem", fontFamily: "'JetBrains Mono', monospace" }}>
              {filename}
            </span>
            {previewValue !== null && (
              <span style={{
                background: "rgba(0,229,160,0.15)", color: "#00E5A0",
                fontSize: "0.6rem", padding: "1px 5px", borderRadius: 3,
                fontFamily: "'JetBrains Mono', monospace",
              }}>
                preview
              </span>
            )}
          </div>
        </div>

        {/* Pending action bar */}
        {pendingAction && (
          <div className="me-action-bar" style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "8px 12px", background: "rgba(0,212,232,0.05)",
            borderBottom: "1px solid rgba(0,212,232,0.2)",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{
                width: 6, height: 6, borderRadius: "50%",
                background: "#00E5A0", boxShadow: "0 0 8px #00E5A0",
              }} />
              <span style={{ color: "#8A9BB8", fontSize: "0.78rem", fontFamily: "'DM Sans', sans-serif" }}>
                {pendingAction.explanation || `AI suggests: ${pendingAction.action}`}
              </span>
              <span style={{
                background: "rgba(0,212,232,0.1)", color: "#00D4E8",
                fontSize: "0.65rem", padding: "2px 6px", borderRadius: 3,
                fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase",
              }}>
                {pendingAction.action}
              </span>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={handleAccept}
                className="me-accept-btn"
                style={{
                  display: "flex", alignItems: "center", gap: 5,
                  background: "rgba(0,229,160,0.1)", border: "1px solid rgba(0,229,160,0.3)",
                  color: "#00E5A0", fontSize: "0.75rem", padding: "5px 12px",
                  borderRadius: 4, cursor: "pointer", fontFamily: "'DM Sans', sans-serif",
                  fontWeight: 500, transition: "all 0.15s",
                }}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="2,6 5,9 10,3" />
                </svg>
                Accept
              </button>
              <button
                onClick={handleReject}
                className="me-reject-btn"
                style={{
                  display: "flex", alignItems: "center", gap: 5,
                  background: "rgba(255,77,109,0.1)", border: "1px solid rgba(255,77,109,0.3)",
                  color: "#FF4D6D", fontSize: "0.75rem", padding: "5px 12px",
                  borderRadius: 4, cursor: "pointer", fontFamily: "'DM Sans', sans-serif",
                  fontWeight: 500, transition: "all 0.15s",
                }}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="2" y1="2" x2="10" y2="10" />
                  <line x1="10" y1="2" x2="2" y2="10" />
                </svg>
                Reject
              </button>
            </div>
          </div>
        )}

        {/* Monaco Editor */}
        <div style={{ flex: 1, overflow: "hidden" }}>
          <Editor
            height="100%"
            language={language}
            value={previewValue ?? value}
            onChange={handleChange}
            onMount={handleEditorMount}
            theme="senorita"
            options={{
              readOnly: readOnly || previewValue !== null,
              fontSize: 13,
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
              fontLigatures: true,
              lineHeight: 1.6,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              padding: { top: 12, bottom: 12 },
              renderLineHighlight: "line",
              cursorBlinking: "smooth",
              cursorSmoothCaretAnimation: "on",
              smoothScrolling: true,
              bracketPairColorization: { enabled: true },
              guides: { indentation: true, bracketPairs: true },
              wordWrap: "on",
              automaticLayout: true,
            }}
          />
        </div>

        {/* Status bar */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          height: 22, padding: "0 12px",
          background: "#060810", borderTop: "1px solid #0F1420",
          fontSize: "0.68rem", fontFamily: "'JetBrains Mono', monospace", color: "#2A3555",
        }}>
          <div style={{ display: "flex", gap: 16 }}>
            <span style={{ color: "#00D4E8" }}>⬡ {language}</span>
            <span>UTF-8</span>
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <span>Ln {getCursorLine()}</span>
            {previewValue !== null && (
              <span style={{ color: "#00E5A0" }}>● Preview Mode</span>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

export default MonacoEditor;
