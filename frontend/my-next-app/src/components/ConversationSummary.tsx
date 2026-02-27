"use client";

import { useEffect, useRef, useState } from "react";

/* ============================================================
   TYPES
   ============================================================ */
interface IntentBreakdown {
  intent: string;
  count: number;
  description: string;
}

interface KeyAction {
  step: number;
  action: string;
  detail: string;
  type: "user" | "ai" | "code";
}

interface Insight {
  icon: string;
  title: string;
  body: string;
}

interface SummaryStats {
  total_messages: number;
  user_messages: number;
  ai_messages: number;
  code_blocks: number;
  intents_used: string[];
}

interface CodeChange {
  heading: string;
  description: string;
  action: string;
  filename: string;
}

export interface ConversationSummaryData {
  title: string;
  overview: string;
  intent_breakdown: IntentBreakdown[];
  key_actions: KeyAction[];
  flowchart: string;
  code_changes?: CodeChange[];
  code_topics: string[];
  insights: Insight[];
  stats: SummaryStats;
}

interface ConversationSummaryProps {
  data: ConversationSummaryData;
  onClose?: () => void;
}

/* ============================================================
   INTENT PILL COLORS
   ============================================================ */
const INTENT_COLORS: Record<string, { text: string; bg: string }> = {
  generate:  { text: "#4ade80", bg: "rgba(74,222,128,0.1)"  },
  refactor:  { text: "#38bdf8", bg: "rgba(56,189,248,0.1)"  },
  explain:   { text: "#fbbf24", bg: "rgba(251,191,36,0.1)"  },
  fix:       { text: "#f87171", bg: "rgba(248,113,113,0.1)" },
  test:      { text: "#a78bfa", bg: "rgba(167,139,250,0.1)" },
  document:  { text: "#67e8f9", bg: "rgba(103,232,249,0.1)" },
  chat:      { text: "#94a3b8", bg: "rgba(148,163,184,0.1)" },
};

function intentStyle(intent: string) {
  return INTENT_COLORS[intent.toLowerCase()] ?? { text: "#94a3b8", bg: "rgba(148,163,184,0.1)" };
}

/* ============================================================
   ACTION ICON MAP
   ============================================================ */
const ACTION_ICONS: Record<string, string> = {
  insert:           "＋",
  replace_file:     "↺",
  replace_selection:"✎",
  delete_lines:     "−",
};

/* ============================================================
   MERMAID DIAGRAM RENDERER
   ============================================================ */
function MermaidDiagram({ chart }: { chart: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [svg, setSvg] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    async function render() {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: "base",
          themeVariables: {
            background: "#13151f",
            primaryColor: "#1e2235",
            primaryTextColor: "#cbd5e1",
            primaryBorderColor: "#2d3555",
            lineColor: "#3d4a6e",
            secondaryColor: "#1a1e30",
            tertiaryColor: "#111520",
            edgeLabelBackground: "#13151f",
            nodeTextColor: "#cbd5e1",
            fontFamily: "Inter, system-ui, sans-serif",
            fontSize: "13px",
          },
          flowchart: { curve: "basis", htmlLabels: true, padding: 12 },
          securityLevel: "loose",
        });
        const id = `mermaid-${Date.now()}`;
        const { svg: rendered } = await mermaid.render(id, chart);
        if (!cancelled) setSvg(rendered);
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    }
    render();
    return () => { cancelled = true; };
  }, [chart]);

  if (error) {
    return (
      <div style={{
        padding: "14px 16px",
        background: "rgba(248,113,113,0.06)",
        border: "1px solid rgba(248,113,113,0.18)",
        borderRadius: 8,
        color: "#f87171",
        fontSize: "0.8rem",
        fontFamily: "monospace",
      }}>
        <div style={{ marginBottom: 6, fontWeight: 600 }}>Could not render diagram</div>
        <pre style={{ whiteSpace: "pre-wrap", color: "#64748b", margin: 0, fontSize: "0.72rem" }}>{chart}</pre>
      </div>
    );
  }

  if (!svg) {
    return (
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        height: 120, color: "#475569", fontSize: "0.82rem", gap: 10,
      }}>
        <div style={{
          width: 16, height: 16, borderRadius: "50%",
          border: "2px solid #38bdf8", borderTopColor: "transparent",
          animation: "csSpin 0.7s linear infinite",
        }} />
        Rendering…
      </div>
    );
  }

  return (
    <div
      ref={ref}
      style={{ width: "100%", overflowX: "auto" }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

/* ============================================================
   DIVIDER
   ============================================================ */
function Divider() {
  return <div style={{ height: 1, background: "#1e2235", margin: "24px 0" }} />;
}

/* ============================================================
   SECTION LABEL
   ============================================================ */
function Label({ children }: { children: string }) {
  return (
    <div style={{
      fontSize: "0.68rem",
      fontWeight: 600,
      letterSpacing: "0.08em",
      textTransform: "uppercase",
      color: "#475569",
      marginBottom: 14,
    }}>
      {children}
    </div>
  );
}

/* ============================================================
   MAIN COMPONENT
   ============================================================ */
export function ConversationSummary({ data, onClose }: ConversationSummaryProps) {
  const maxCount = Math.max(...(data.intent_breakdown?.map(i => i.count) ?? [1]), 1);

  return (
    <>
      <style>{`
        @keyframes csSpin { to { transform: rotate(360deg); } }
        @keyframes csFade {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .cs-root { animation: csFade 0.3s ease forwards; }
        .cs-mermaid svg { background: transparent !important; max-width: 100%; }
        .cs-tag { transition: background 0.15s, color 0.15s; }
        .cs-tag:hover { background: rgba(56,189,248,0.15) !important; color: #38bdf8 !important; }
        .cs-change-row:hover { background: #1a1e2e !important; }
      `}</style>

      <div
        className="cs-root"
        style={{
          height: "100%",
          overflowY: "auto",
          background: "#0f111a",
          fontFamily: "Inter, system-ui, -apple-system, sans-serif",
          color: "#cbd5e1",
          padding: "28px 26px 48px",
          lineHeight: 1.6,
        }}
      >
        {/* ── Title + Overview ── */}
        <div style={{ marginBottom: 0 }}>
          <h1 style={{
            fontSize: "1.15rem",
            fontWeight: 600,
            color: "#e2e8f0",
            margin: "0 0 10px",
            letterSpacing: "-0.01em",
          }}>
            {data.title}
          </h1>
          <p style={{
            fontSize: "0.88rem",
            color: "#64748b",
            margin: 0,
            lineHeight: 1.7,
          }}>
            {data.overview}
          </p>
        </div>

        <Divider />

        {/* ── Stats ── */}
        {data.stats && (
          <div style={{ marginBottom: 0 }}>
            <Label>Session Stats</Label>
            <div style={{ display: "flex", gap: 8 }}>
              {[
                { value: data.stats.total_messages, label: "Messages",    color: "#38bdf8" },
                { value: data.stats.user_messages,  label: "From you",    color: "#a78bfa" },
                { value: data.stats.ai_messages,    label: "AI replies",  color: "#4ade80" },
                { value: data.stats.code_blocks,    label: "Code blocks", color: "#fbbf24" },
              ].map((s, i) => (
                <div key={i} style={{
                  flex: 1,
                  background: "#13151f",
                  border: "1px solid #1e2235",
                  borderRadius: 10,
                  padding: "12px 14px",
                  textAlign: "center",
                }}>
                  <div style={{
                    fontSize: "1.5rem",
                    fontWeight: 700,
                    color: s.color,
                    lineHeight: 1,
                    marginBottom: 5,
                    fontVariantNumeric: "tabular-nums",
                  }}>
                    {s.value}
                  </div>
                  <div style={{ fontSize: "0.65rem", color: "#475569", letterSpacing: "0.04em" }}>
                    {s.label}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <Divider />

        {/* ── Code Changes ── */}
        {data.code_changes && data.code_changes.length > 0 && (
          <>
            <div style={{ marginBottom: 0 }}>
              <Label>Code Changes</Label>
              <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                {data.code_changes.map((change, i) => {
                  const icon = ACTION_ICONS[change.action] ?? "·";
                  const isInsert = change.action === "insert";
                  const isDelete = change.action === "delete_lines";
                  const dotColor = isInsert ? "#4ade80" : isDelete ? "#f87171" : "#38bdf8";
                  return (
                    <div
                      key={i}
                      className="cs-change-row"
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 12,
                        padding: "11px 14px",
                        borderRadius: 8,
                        background: "transparent",
                        transition: "background 0.15s",
                      }}
                    >
                      {/* Icon */}
                      <div style={{
                        width: 26, height: 26, borderRadius: 6, flexShrink: 0,
                        background: `${dotColor}18`,
                        border: `1px solid ${dotColor}30`,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: "0.9rem", color: dotColor, marginTop: 1,
                        fontWeight: 600,
                      }}>
                        {icon}
                      </div>

                      {/* Content */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontSize: "0.88rem",
                          fontWeight: 500,
                          color: "#e2e8f0",
                          marginBottom: 3,
                        }}>
                          {change.heading}
                        </div>
                        <div style={{
                          fontSize: "0.78rem",
                          color: "#64748b",
                          lineHeight: 1.5,
                        }}>
                          {change.description}
                        </div>
                      </div>

                      {/* Filename badge */}
                      <div style={{
                        flexShrink: 0,
                        fontSize: "0.65rem",
                        color: "#475569",
                        background: "#1a1e2e",
                        border: "1px solid #1e2235",
                        padding: "2px 7px",
                        borderRadius: 4,
                        fontFamily: "monospace",
                        alignSelf: "center",
                        maxWidth: 120,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}>
                        {change.filename}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <Divider />
          </>
        )}

        {/* ── Intent Breakdown ── */}
        {data.intent_breakdown?.length > 0 && (
          <>
            <div style={{ marginBottom: 0 }}>
              <Label>Intent Breakdown</Label>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {data.intent_breakdown.map((item, i) => {
                  const s = intentStyle(item.intent);
                  const pct = Math.round((item.count / maxCount) * 100);
                  return (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <span style={{
                        fontSize: "0.65rem", fontWeight: 600,
                        color: s.text, background: s.bg,
                        padding: "2px 8px", borderRadius: 20,
                        textTransform: "uppercase", letterSpacing: "0.05em",
                        flexShrink: 0, minWidth: 72, textAlign: "center",
                        fontFamily: "monospace",
                      }}>
                        {item.intent}
                      </span>
                      <div style={{ flex: 1, height: 5, background: "#1e2235", borderRadius: 3, overflow: "hidden" }}>
                        <div style={{
                          height: "100%", width: `${pct}%`,
                          background: s.text, borderRadius: 3,
                          opacity: 0.7,
                          transition: "width 0.7s ease",
                        }} />
                      </div>
                      <span style={{ fontSize: "0.75rem", color: "#475569", flexShrink: 0, width: 20, textAlign: "right" }}>
                        {item.count}
                      </span>
                      <span style={{ fontSize: "0.78rem", color: "#475569", flex: 2, minWidth: 0 }}>
                        {item.description}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
            <Divider />
          </>
        )}

        {/* ── Conversation Flow (Mermaid) ── */}
        {data.flowchart && (
          <>
            <div style={{ marginBottom: 0 }}>
              <Label>Conversation Flow</Label>
              <div
                className="cs-mermaid"
                style={{
                  background: "#13151f",
                  border: "1px solid #1e2235",
                  borderRadius: 10,
                  padding: "18px 14px",
                  overflow: "hidden",
                }}
              >
                <MermaidDiagram chart={data.flowchart} />
              </div>
            </div>
            <Divider />
          </>
        )}

        {/* ── Key Actions ── */}
        {data.key_actions?.length > 0 && (
          <>
            <div style={{ marginBottom: 0 }}>
              <Label>Key Actions</Label>
              <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                {data.key_actions.map((action, i) => {
                  const isUser = action.type === "user";
                  const isCode = action.type === "code";
                  const dotColor = isUser ? "#38bdf8" : isCode ? "#fbbf24" : "#4ade80";
                  return (
                    <div key={i} style={{
                      display: "flex", gap: 14, paddingBottom: 16,
                      position: "relative",
                    }}>
                      {/* Line + dot */}
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0, width: 20 }}>
                        <div style={{
                          width: 8, height: 8, borderRadius: "50%",
                          background: dotColor, marginTop: 5, flexShrink: 0,
                          boxShadow: `0 0 5px ${dotColor}60`,
                        }} />
                        {i < data.key_actions.length - 1 && (
                          <div style={{ flex: 1, width: 1, background: "#1e2235", marginTop: 4 }} />
                        )}
                      </div>
                      {/* Text */}
                      <div style={{ flex: 1, paddingTop: 2 }}>
                        <div style={{ fontSize: "0.88rem", fontWeight: 500, color: "#e2e8f0", marginBottom: 2 }}>
                          {action.action}
                        </div>
                        <div style={{ fontSize: "0.78rem", color: "#64748b" }}>
                          {action.detail}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <Divider />
          </>
        )}

        {/* ── Insights ── */}
        {data.insights?.length > 0 && (
          <>
            <div style={{ marginBottom: 0 }}>
              <Label>Insights</Label>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {data.insights.map((ins, i) => (
                  <div key={i} style={{
                    display: "flex", alignItems: "flex-start", gap: 12,
                    padding: "12px 14px",
                    background: "#13151f",
                    border: "1px solid #1e2235",
                    borderRadius: 8,
                  }}>
                    <span style={{ fontSize: "1.1rem", flexShrink: 0, marginTop: 1 }}>{ins.icon}</span>
                    <div>
                      <div style={{ fontSize: "0.85rem", fontWeight: 500, color: "#e2e8f0", marginBottom: 3 }}>
                        {ins.title}
                      </div>
                      <div style={{ fontSize: "0.78rem", color: "#64748b", lineHeight: 1.55 }}>
                        {ins.body}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <Divider />
          </>
        )}

        {/* ── Topics ── */}
        {data.code_topics?.length > 0 && (
          <div>
            <Label>Topics Covered</Label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {data.code_topics.map((topic, i) => (
                <span
                  key={i}
                  className="cs-tag"
                  style={{
                    fontSize: "0.75rem",
                    color: "#475569",
                    background: "#13151f",
                    border: "1px solid #1e2235",
                    padding: "4px 11px",
                    borderRadius: 20,
                    cursor: "default",
                    fontFamily: "monospace",
                  }}
                >
                  {topic}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
