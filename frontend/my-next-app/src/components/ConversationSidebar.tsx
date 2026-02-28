"use client";

import { useState, useRef, useEffect } from "react";
import { ConversationSummary } from "../hooks/useConversations";

/* ============================================================
   STYLES
   ============================================================ */
const SIDEBAR_STYLES = `
  @keyframes csSlideIn {
    from { opacity: 0; transform: translateX(-8px); }
    to { opacity: 1; transform: translateX(0); }
  }
  @keyframes csFadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  .cs-scrollbar::-webkit-scrollbar {
    width: 4px;
  }
  .cs-scrollbar::-webkit-scrollbar-track {
    background: transparent;
  }
  .cs-scrollbar::-webkit-scrollbar-thumb {
    background: rgba(0,212,232,0.2);
    border-radius: 4px;
  }
  .cs-scrollbar::-webkit-scrollbar-thumb:hover {
    background: rgba(0,212,232,0.35);
  }
`;

/* ============================================================
   PROPS
   ============================================================ */
interface ConversationSidebarProps {
  conversations: ConversationSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  isOpen: boolean;
  onClose: () => void;
}

/* ============================================================
   COMPONENT
   ============================================================ */
export function ConversationSidebar({
  conversations,
  activeId,
  onSelect,
  onNew,
  onDelete,
  onRename,
  isOpen,
  onClose,
}: ConversationSidebarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);

  // Focus input when editing
  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  // Close context menu on outside click
  useEffect(() => {
    const handleClick = () => {
      if (contextMenu) {
        setContextMenu(null);
      }
    };
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [contextMenu]);

  // Close sidebar on outside click (mobile)
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (isOpen && sidebarRef.current && !sidebarRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [isOpen, onClose]);

  const handleStartEdit = (conv: ConversationSummary) => {
    setEditingId(conv.id);
    setEditTitle(conv.title);
    setContextMenu(null);
  };

  const handleSaveEdit = () => {
    if (editingId && editTitle.trim()) {
      onRename(editingId, editTitle.trim());
    }
    setEditingId(null);
    setEditTitle("");
  };

  const handleContextMenu = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    setContextMenu({ id, x: e.clientX, y: e.clientY });
  };

  const formatDate = (date: Date) => {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    
    if (days === 0) {
      return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } else if (days === 1) {
      return "Yesterday";
    } else if (days < 7) {
      return date.toLocaleDateString([], { weekday: "short" });
    } else {
      return date.toLocaleDateString([], { month: "short", day: "numeric" });
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <style>{SIDEBAR_STYLES}</style>
      
      {/* Backdrop */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.5)",
          zIndex: 998,
          animation: "csFadeIn 0.15s ease",
        }}
        onClick={onClose}
      />
      
      {/* Sidebar */}
      <div
        ref={sidebarRef}
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          bottom: 0,
          width: 280,
          background: "#0A0D14",
          borderRight: "1px solid #1A2033",
          zIndex: 999,
          display: "flex",
          flexDirection: "column",
          animation: "csSlideIn 0.2s ease",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 14px",
            borderBottom: "1px solid #1A2033",
          }}
        >
          <span
            style={{
              fontSize: "0.75rem",
              fontFamily: "'JetBrains Mono', monospace",
              color: "#5A6888",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            Conversations
          </span>
          
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {/* New conversation button */}
            <button
              onClick={onNew}
              title="New conversation"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 26,
                height: 26,
                background: "rgba(0,212,232,0.1)",
                border: "1px solid rgba(0,212,232,0.25)",
                borderRadius: 5,
                cursor: "pointer",
                transition: "all 0.15s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(0,212,232,0.2)";
                e.currentTarget.style.borderColor = "rgba(0,212,232,0.4)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "rgba(0,212,232,0.1)";
                e.currentTarget.style.borderColor = "rgba(0,212,232,0.25)";
              }}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                stroke="#00D4E8"
                strokeWidth="1.8"
                strokeLinecap="round"
              >
                <line x1="7" y1="3" x2="7" y2="11" />
                <line x1="3" y1="7" x2="11" y2="7" />
              </svg>
            </button>
            
            {/* Close button */}
            <button
              onClick={onClose}
              title="Close"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 26,
                height: 26,
                background: "transparent",
                border: "1px solid #1A2033",
                borderRadius: 5,
                cursor: "pointer",
                transition: "all 0.15s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "#2A3555";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "#1A2033";
              }}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 12 12"
                fill="none"
                stroke="#5A6888"
                strokeWidth="1.5"
                strokeLinecap="round"
              >
                <line x1="2" y1="2" x2="10" y2="10" />
                <line x1="10" y1="2" x2="2" y2="10" />
              </svg>
            </button>
          </div>
        </div>

        {/* Conversation list */}
        <div
          className="cs-scrollbar"
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "8px",
          }}
        >
          {conversations.length === 0 ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                padding: "40px 20px",
                textAlign: "center",
              }}
            >
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: "50%",
                  background: "rgba(0,212,232,0.06)",
                  border: "1px solid #1A2033",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: 12,
                }}
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 18 18"
                  fill="none"
                  stroke="#2A3555"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                >
                  <path d="M3 14V4a2 2 0 012-2h8a2 2 0 012 2v6a2 2 0 01-2 2H6l-3 2z" />
                </svg>
              </div>
              <p style={{ fontSize: "0.8rem", color: "#3A4560", margin: 0 }}>
                No conversations yet
              </p>
              <p style={{ fontSize: "0.72rem", color: "#2A3555", marginTop: 4 }}>
                Click + to start a new one
              </p>
            </div>
          ) : (
            conversations.map((conv) => {
              const isActive = conv.id === activeId;
              const isEditing = conv.id === editingId;

              return (
                <div
                  key={conv.id}
                  onClick={() => !isEditing && onSelect(conv.id)}
                  onContextMenu={(e) => handleContextMenu(e, conv.id)}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    padding: "10px 12px",
                    marginBottom: 4,
                    background: isActive ? "rgba(0,212,232,0.08)" : "transparent",
                    border: `1px solid ${isActive ? "rgba(0,212,232,0.2)" : "transparent"}`,
                    borderRadius: 8,
                    cursor: isEditing ? "default" : "pointer",
                    transition: "all 0.15s",
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive && !isEditing) {
                      e.currentTarget.style.background = "rgba(255,255,255,0.02)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.background = "transparent";
                    }
                  }}
                >
                  {/* Title row */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {isEditing ? (
                      <input
                        ref={editInputRef}
                        type="text"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        onBlur={handleSaveEdit}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleSaveEdit();
                          if (e.key === "Escape") {
                            setEditingId(null);
                            setEditTitle("");
                          }
                        }}
                        style={{
                          flex: 1,
                          background: "#0E111A",
                          border: "1px solid rgba(0,212,232,0.3)",
                          borderRadius: 4,
                          padding: "4px 8px",
                          fontSize: "0.82rem",
                          color: "#C8D5E8",
                          fontFamily: "'DM Sans', sans-serif",
                          outline: "none",
                        }}
                      />
                    ) : (
                      <>
                        <span
                          style={{
                            flex: 1,
                            fontSize: "0.82rem",
                            color: isActive ? "#00D4E8" : "#9BAAC8",
                            fontFamily: "'DM Sans', sans-serif",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {conv.title}
                        </span>
                        <span
                          style={{
                            fontSize: "0.66rem",
                            color: "#3A4560",
                            fontFamily: "'JetBrains Mono', monospace",
                            flexShrink: 0,
                          }}
                        >
                          {formatDate(conv.updatedAt)}
                        </span>
                      </>
                    )}
                  </div>

                  {/* Preview */}
                  {!isEditing && conv.preview && (
                    <p
                      style={{
                        fontSize: "0.72rem",
                        color: "#3A4560",
                        margin: "4px 0 0 0",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {conv.preview}
                    </p>
                  )}

                  {/* Message count */}
                  {!isEditing && (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                        marginTop: 6,
                      }}
                    >
                      <span
                        style={{
                          fontSize: "0.62rem",
                          color: "#2A3555",
                          fontFamily: "'JetBrains Mono', monospace",
                        }}
                      >
                        {conv.messageCount} messages
                      </span>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          style={{
            position: "fixed",
            left: contextMenu.x,
            top: contextMenu.y,
            background: "#0E111A",
            border: "1px solid #1A2033",
            borderRadius: 6,
            padding: 4,
            zIndex: 1000,
            boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
            animation: "csFadeIn 0.1s ease",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => {
              const conv = conversations.find((c) => c.id === contextMenu.id);
              if (conv) handleStartEdit(conv);
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              width: "100%",
              padding: "6px 12px",
              background: "transparent",
              border: "none",
              borderRadius: 4,
              color: "#9BAAC8",
              fontSize: "0.78rem",
              fontFamily: "'DM Sans', sans-serif",
              cursor: "pointer",
              textAlign: "left",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(255,255,255,0.05)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
            }}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
            >
              <path d="M8.5 1.5l2 2-7 7H1.5v-2l7-7z" />
            </svg>
            Rename
          </button>
          <button
            onClick={() => {
              onDelete(contextMenu.id);
              setContextMenu(null);
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              width: "100%",
              padding: "6px 12px",
              background: "transparent",
              border: "none",
              borderRadius: 4,
              color: "#FF4D6D",
              fontSize: "0.78rem",
              fontFamily: "'DM Sans', sans-serif",
              cursor: "pointer",
              textAlign: "left",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(255,77,109,0.1)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
            }}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
            >
              <path d="M2 3h8M4 3V2a1 1 0 011-1h2a1 1 0 011 1v1M9 3v7a1 1 0 01-1 1H4a1 1 0 01-1-1V3" />
            </svg>
            Delete
          </button>
        </div>
      )}
    </>
  );
}
