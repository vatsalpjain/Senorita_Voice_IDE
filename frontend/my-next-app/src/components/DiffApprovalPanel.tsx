"use client";

/**
 * DiffApprovalPanel — Shows proposed edits in a diff view with Accept/Reject buttons
 * 
 * Uses Monaco DiffEditor to display original vs proposed content
 * User can accept/reject individual edits or accept all at once
 */

import { useMemo } from "react";
import { DiffEditor } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { PendingEdit } from "../types/edits";
import { describeEditAction, computeDiffSummary } from "../utils/applyEdit";
import { getLanguageFromFilename } from "../services/fileSystemService";

/* ============================================================
   TYPES
   ============================================================ */
export interface DiffApprovalPanelProps {
  // Current edit to display
  activeEdit: PendingEdit | null;
  
  // All pending edits for the file list
  edits: PendingEdit[];
  
  // Counts
  pendingCount: number;
  acceptedCount: number;
  rejectedCount: number;
  
  // Actions
  onSelectEdit: (editId: string) => void;
  onAccept: (editId: string) => void;
  onReject: (editId: string) => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  
  // Loading state
  isProcessing?: boolean;
}

/* ============================================================
   THEME CONFIG — matches MonacoEditor theme
   ============================================================ */
const DIFF_THEME: editor.IStandaloneThemeData = {
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
    "editorLineNumber.foreground": "#2A3555",
    "editorLineNumber.activeForeground": "#00D4E8",
    "editor.selectionBackground": "#1A3050",
    "editor.lineHighlightBackground": "#0D1020",
    "editorCursor.foreground": "#00D4E8",
    "diffEditor.insertedTextBackground": "#00E5A020",
    "diffEditor.removedTextBackground": "#FF5F5720",
    "diffEditor.insertedLineBackground": "#00E5A010",
    "diffEditor.removedLineBackground": "#FF5F5710",
  },
};

/* ============================================================
   COMPONENT
   ============================================================ */
export function DiffApprovalPanel({
  activeEdit,
  edits,
  pendingCount,
  acceptedCount,
  rejectedCount,
  onSelectEdit,
  onAccept,
  onReject,
  onAcceptAll,
  onRejectAll,
  isProcessing = false,
}: DiffApprovalPanelProps) {
  // Compute diff summary for active edit
  const diffSummary = useMemo(() => {
    if (!activeEdit) return null;
    return computeDiffSummary(activeEdit.originalContent, activeEdit.proposedContent);
  }, [activeEdit]);

  // Get language for syntax highlighting
  const language = useMemo(() => {
    if (!activeEdit) return "plaintext";
    return getLanguageFromFilename(activeEdit.filePath);
  }, [activeEdit]);

  // Handle Monaco mount to set theme
  const handleEditorMount = (editor: editor.IStandaloneDiffEditor, monaco: typeof import("monaco-editor")) => {
    monaco.editor.defineTheme("senorita-diff", DIFF_THEME);
    monaco.editor.setTheme("senorita-diff");
  };

  // No edits to show
  if (edits.length === 0) {
    return (
      <div style={styles.emptyContainer}>
        <div style={styles.emptyIcon}>📝</div>
        <div style={styles.emptyText}>No pending edits</div>
        <div style={styles.emptySubtext}>
          AI-generated changes will appear here for your review
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* Header with counts and bulk actions */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <span style={styles.title}>Proposed Changes</span>
          <div style={styles.counts}>
            {pendingCount > 0 && (
              <span style={styles.countBadge}>
                <span style={{ ...styles.countDot, background: "#F6C90E" }} />
                {pendingCount} pending
              </span>
            )}
            {acceptedCount > 0 && (
              <span style={styles.countBadge}>
                <span style={{ ...styles.countDot, background: "#00E5A0" }} />
                {acceptedCount} accepted
              </span>
            )}
            {rejectedCount > 0 && (
              <span style={styles.countBadge}>
                <span style={{ ...styles.countDot, background: "#FF5F57" }} />
                {rejectedCount} rejected
              </span>
            )}
          </div>
        </div>
        <div style={styles.headerRight}>
          <button
            style={styles.bulkButton}
            onClick={onRejectAll}
            disabled={pendingCount === 0 || isProcessing}
          >
            Reject All
          </button>
          <button
            style={styles.acceptAllButton}
            onClick={onAcceptAll}
            disabled={pendingCount === 0 || isProcessing}
          >
            ✓ Accept All ({pendingCount})
          </button>
        </div>
      </div>

      {/* File list sidebar + diff view */}
      <div style={styles.content}>
        {/* File list */}
        <div style={styles.fileList}>
          {edits.map((edit) => (
            <div
              key={edit.id}
              style={{
                ...styles.fileItem,
                ...(edit.id === activeEdit?.id ? styles.fileItemActive : {}),
                ...(edit.status === "accepted" ? styles.fileItemAccepted : {}),
                ...(edit.status === "rejected" ? styles.fileItemRejected : {}),
              }}
              onClick={() => onSelectEdit(edit.id)}
            >
              <div style={styles.fileIcon}>
                {edit.status === "accepted" ? "✓" : edit.status === "rejected" ? "✗" : "○"}
              </div>
              <div style={styles.fileInfo}>
                <div style={styles.fileName}>{edit.filePath.split("/").pop()}</div>
                <div style={styles.fileAction}>{describeEditAction(edit)}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Diff editor */}
        <div style={styles.diffContainer}>
          {activeEdit ? (
            <>
              {/* Edit info bar */}
              <div style={styles.editInfoBar}>
                <div style={styles.editPath}>{activeEdit.filePath}</div>
                {diffSummary && (
                  <div style={styles.diffStats}>
                    <span style={styles.statAdded}>+{diffSummary.added}</span>
                    <span style={styles.statRemoved}>-{diffSummary.removed}</span>
                  </div>
                )}
              </div>

              {/* Explanation */}
              {activeEdit.explanation && (
                <div style={styles.explanation}>
                  💡 {activeEdit.explanation}
                </div>
              )}

              {/* Monaco Diff Editor */}
              <div style={styles.diffEditor}>
                <DiffEditor
                  original={activeEdit.originalContent}
                  modified={activeEdit.proposedContent}
                  language={language}
                  theme="vs-dark"
                  onMount={handleEditorMount}
                  options={{
                    readOnly: true,
                    renderSideBySide: true,
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    fontSize: 13,
                    lineNumbers: "on",
                    renderOverviewRuler: false,
                    diffWordWrap: "on",
                    ignoreTrimWhitespace: false,
                  }}
                />
              </div>

              {/* Action buttons for current edit */}
              {activeEdit.status === "pending" && (
                <div style={styles.actionBar}>
                  <button
                    style={styles.rejectButton}
                    onClick={() => onReject(activeEdit.id)}
                    disabled={isProcessing}
                  >
                    ✗ Reject
                  </button>
                  <button
                    style={styles.acceptButton}
                    onClick={() => onAccept(activeEdit.id)}
                    disabled={isProcessing}
                  >
                    ✓ Accept Change
                  </button>
                </div>
              )}

              {/* Status badge for completed edits */}
              {activeEdit.status !== "pending" && (
                <div style={styles.statusBar}>
                  <span
                    style={{
                      ...styles.statusBadge,
                      background: activeEdit.status === "accepted" ? "#00E5A020" : "#FF5F5720",
                      color: activeEdit.status === "accepted" ? "#00E5A0" : "#FF5F57",
                    }}
                  >
                    {activeEdit.status === "accepted" ? "✓ Accepted" : "✗ Rejected"}
                  </span>
                </div>
              )}
            </>
          ) : (
            <div style={styles.noSelection}>
              Select an edit from the list to view changes
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   STYLES
   ============================================================ */
const styles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    background: "#0A0C14",
    borderRadius: 8,
    border: "1px solid #1A2033",
    overflow: "hidden",
  },
  emptyContainer: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    padding: 40,
    textAlign: "center",
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 16,
    opacity: 0.5,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: 600,
    color: "#8A9BB8",
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 13,
    color: "#5A6888",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "12px 16px",
    borderBottom: "1px solid #1A2033",
    background: "#0D1020",
  },
  headerLeft: {
    display: "flex",
    alignItems: "center",
    gap: 16,
  },
  title: {
    fontSize: 14,
    fontWeight: 600,
    color: "#C8D5E8",
  },
  counts: {
    display: "flex",
    gap: 12,
  },
  countBadge: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12,
    color: "#8A9BB8",
  },
  countDot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
  },
  headerRight: {
    display: "flex",
    gap: 8,
  },
  bulkButton: {
    padding: "6px 12px",
    fontSize: 12,
    fontWeight: 500,
    color: "#8A9BB8",
    background: "transparent",
    border: "1px solid #2A3555",
    borderRadius: 6,
    cursor: "pointer",
    transition: "all 0.2s",
  },
  acceptAllButton: {
    padding: "6px 16px",
    fontSize: 12,
    fontWeight: 600,
    color: "#08090F",
    background: "#00E5A0",
    border: "none",
    borderRadius: 6,
    cursor: "pointer",
    transition: "all 0.2s",
  },
  content: {
    display: "flex",
    flex: 1,
    overflow: "hidden",
  },
  fileList: {
    width: 220,
    borderRight: "1px solid #1A2033",
    overflowY: "auto",
    background: "#080A10",
  },
  fileItem: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    cursor: "pointer",
    borderBottom: "1px solid #0F1420",
    transition: "background 0.15s",
  },
  fileItemActive: {
    background: "#1A2033",
  },
  fileItemAccepted: {
    opacity: 0.6,
  },
  fileItemRejected: {
    opacity: 0.4,
  },
  fileIcon: {
    fontSize: 14,
    color: "#5A6888",
  },
  fileInfo: {
    flex: 1,
    minWidth: 0,
  },
  fileName: {
    fontSize: 13,
    fontWeight: 500,
    color: "#C8D5E8",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  fileAction: {
    fontSize: 11,
    color: "#5A6888",
    marginTop: 2,
  },
  diffContainer: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  editInfoBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "8px 16px",
    background: "#0D1020",
    borderBottom: "1px solid #1A2033",
  },
  editPath: {
    fontSize: 12,
    fontFamily: "'JetBrains Mono', monospace",
    color: "#8A9BB8",
  },
  diffStats: {
    display: "flex",
    gap: 12,
    fontSize: 12,
    fontFamily: "'JetBrains Mono', monospace",
  },
  statAdded: {
    color: "#00E5A0",
  },
  statRemoved: {
    color: "#FF5F57",
  },
  explanation: {
    padding: "10px 16px",
    fontSize: 13,
    color: "#8A9BB8",
    background: "rgba(0, 212, 232, 0.05)",
    borderBottom: "1px solid #1A2033",
  },
  diffEditor: {
    flex: 1,
    overflow: "hidden",
  },
  actionBar: {
    display: "flex",
    justifyContent: "flex-end",
    gap: 12,
    padding: "12px 16px",
    borderTop: "1px solid #1A2033",
    background: "#0D1020",
  },
  rejectButton: {
    padding: "8px 20px",
    fontSize: 13,
    fontWeight: 500,
    color: "#FF5F57",
    background: "transparent",
    border: "1px solid #FF5F5740",
    borderRadius: 6,
    cursor: "pointer",
    transition: "all 0.2s",
  },
  acceptButton: {
    padding: "8px 24px",
    fontSize: 13,
    fontWeight: 600,
    color: "#08090F",
    background: "#00E5A0",
    border: "none",
    borderRadius: 6,
    cursor: "pointer",
    transition: "all 0.2s",
  },
  statusBar: {
    display: "flex",
    justifyContent: "center",
    padding: "12px 16px",
    borderTop: "1px solid #1A2033",
    background: "#0D1020",
  },
  statusBadge: {
    padding: "6px 16px",
    fontSize: 12,
    fontWeight: 600,
    borderRadius: 4,
  },
  noSelection: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    fontSize: 14,
    color: "#5A6888",
  },
};

export default DiffApprovalPanel;
