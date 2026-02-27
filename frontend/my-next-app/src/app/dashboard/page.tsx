"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import {
  getActivities,
  getContributionMap,
  clearActivities,
  ActivityEvent,
} from "../../store/activityStore";

/* ============================================================
   MOCK SEED DATA — injected once into localStorage on first visit
   ============================================================ */
const MOCK_FILES = [
  "components/VoicePanel.tsx", "app/editor/page.tsx", "app/page.tsx",
  "services/aiService.ts", "store/activityStore.ts", "components/MonacoEditor.tsx",
  "app/dashboard/page.tsx", "lib/WSClient.ts", "hooks/useVoice.ts",
  "utils/formatCode.ts",
];
const MOCK_DESCRIPTIONS = [
  "Refactored voice command parser", "Added TypeScript types to handler",
  "Fixed WebSocket reconnect logic", "Implemented AI streaming pipeline",
  "Added error boundary to editor", "Optimised Monaco Editor load time",
  "Integrated activity heatmap", "Cleaned up unused imports",
  "Added file system API support", "Implemented summarise endpoint",
  "Fixed cursor position tracking", "Added multi-language support",
  "Refactored sidebar resize logic", "Added dark-mode scrollbar styles",
  "Improved voice waveform animation",
];

function seedMockData(): void {
  if (typeof window === "undefined") return;
  const SEED_KEY = "senorita_mock_seeded_v2";
  if (localStorage.getItem(SEED_KEY)) return; // already seeded

  const now = Date.now();
  const DAY = 86_400_000;

  // Build a realistic commit pattern over the last ~200 days
  // Cluster commits on weekdays, lighter on weekends
  const mockEvents: Omit<ActivityEvent, "id">[] = [];

  const commitDays = [
    // Older burst – 170-190 days ago
    ...Array.from({ length: 12 }, (_, i) => 170 + i * 1.5),
    // Mid burst – 120-140 days ago
    ...Array.from({ length: 18 }, (_, i) => 120 + i),
    // Ramp-up – 80-100 days ago
    ...Array.from({ length: 22 }, (_, i) => 80 + i),
    // Recent active streak – last 30 days (denser)
    ...Array.from({ length: 35 }, (_, i) => 5 + i * 0.8),
  ];

  commitDays.forEach((daysAgo, idx) => {
    const base = now - Math.round(daysAgo) * DAY;
    const count = 1 + (idx % 4); // 1–4 commits per "day"
    for (let c = 0; c < count; c++) {
      const ts = base + c * 3_600_000 + Math.random() * 1_800_000;
      const file = MOCK_FILES[idx % MOCK_FILES.length];
      const desc = MOCK_DESCRIPTIONS[idx % MOCK_DESCRIPTIONS.length];
      mockEvents.push({
        type: c % 5 === 0 ? "reject" : "accept",
        timestamp: ts,
        filename: file,
        project: "Senorita Voice IDE",
        description: desc,
        action: "replace_file",
        linesChanged: 4 + (idx % 20),
      });
    }
  });

  // Write directly to storage (bypass pushActivity to avoid broadcast loops)
  const raw = localStorage.getItem("senorita_activity_log");
  const existing: ActivityEvent[] = raw ? JSON.parse(raw) : [];
  const merged = [
    ...mockEvents.map((e, i) => ({ ...e, id: `mock-${i}-${Math.random().toString(36).slice(2, 6)}` })),
    ...existing,
  ].sort((a, b) => a.timestamp - b.timestamp).slice(-500);
  localStorage.setItem("senorita_activity_log", JSON.stringify(merged));
  localStorage.setItem(SEED_KEY, "1");
}

/* ============================================================
   HELPERS
   ============================================================ */
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Generate the last N days as "YYYY-MM-DD" strings, oldest first */
function lastNDays(n: number): string[] {
  const result: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    result.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
    );
  }
  return result;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = Date.now();
  const diff = now - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatFullTime(ts: number): string {
  return new Date(ts).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function getMonthLabels(days: string[]): { label: string; colIndex: number }[] {
  const seen = new Set<string>();
  const labels: { label: string; colIndex: number }[] = [];
  days.forEach((d, i) => {
    const month = new Date(d).toLocaleString("en-US", { month: "short" });
    const colIndex = Math.floor(i / 7);
    if (!seen.has(month)) {
      seen.add(month);
      labels.push({ label: month, colIndex });
    }
  });
  return labels;
}

function cellColor(count: number): string {
  if (count === 0) return "#161b22";
  if (count === 1) return "#0e4429";
  if (count <= 3) return "#006d32";
  if (count <= 6) return "#26a641";
  return "#39d353";
}

const EVENT_CONFIG: Record<string, { label: string; color: string; dot: string }> = {
  accept:    { label: "Accepted",   color: "#4ade80", dot: "#4ade80" },
  reject:    { label: "Rejected",   color: "#86efac", dot: "#86efac" },
  commit:    { label: "Saved",      color: "#4ade80", dot: "#4ade80" },
  summarize: { label: "Summarized", color: "#22c55e", dot: "#22c55e" },
};

/* ============================================================
   CONTRIBUTION GRID
   ============================================================ */
function ContributionGrid({
  contributionMap,
  days,
}: {
  contributionMap: Record<string, number>;
  days: string[];
}) {
  const todayStr = today();
  const weeks: string[][] = [];
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7));
  }
  const monthLabels = getMonthLabels(days);
  const totalContributions = days.reduce((s, d) => s + (contributionMap[d] ?? 0), 0);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <span style={{ fontSize: "1rem", fontWeight: 600, color: "#e2e8f0" }}>
            {totalContributions}
          </span>
          <span style={{ fontSize: "0.85rem", color: "#475569", marginLeft: 6 }}>
            contributions in the last year
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: "0.7rem", color: "#475569" }}>Less</span>
          {["#161b22", "#0e4429", "#006d32", "#26a641", "#39d353"].map((c, i) => (
            <div key={i} style={{ width: 11, height: 11, borderRadius: 2, background: c }} />
          ))}
          <span style={{ fontSize: "0.7rem", color: "#475569" }}>More</span>
        </div>
      </div>

      <div style={{ overflowX: "auto", paddingBottom: 4 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: "fit-content" }}>
          {/* Month labels */}
          <div style={{ display: "flex", gap: 3, paddingLeft: 28 }}>
            {weeks.map((_, wi) => {
              const monthLabel = monthLabels.find(m => m.colIndex === wi);
              return (
                <div key={wi} style={{ width: 11, fontSize: "0.62rem", color: "#475569", textAlign: "left" }}>
                  {monthLabel ? monthLabel.label : ""}
                </div>
              );
            })}
          </div>

          {/* Day rows */}
          {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((dayName, di) => (
            <div key={di} style={{ display: "flex", alignItems: "center", gap: 3 }}>
              <span style={{
                width: 24, fontSize: "0.62rem", color: di % 2 === 1 ? "#475569" : "transparent",
                textAlign: "right", paddingRight: 4, flexShrink: 0,
              }}>
                {dayName}
              </span>
              {weeks.map((week, wi) => {
                const dateStr = week[di];
                if (!dateStr) return <div key={wi} style={{ width: 11, height: 11 }} />;
                const count = contributionMap[dateStr] ?? 0;
                const isToday = dateStr === todayStr;
                return (
                  <div
                    key={wi}
                    title={`${dateStr}: ${count} contribution${count !== 1 ? "s" : ""}`}
                    style={{
                      width: 11,
                      height: 11,
                      borderRadius: 2,
                      background: cellColor(count),
                      cursor: "default",
                      outline: isToday ? "1px solid #38bdf8" : "none",
                      outlineOffset: 1,
                      transition: "transform 0.1s",
                      flexShrink: 0,
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.transform = "scale(1.4)"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = "scale(1)"; }}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   ACTIVITY LOG ROW
   ============================================================ */
function LogRow({ event }: { event: ActivityEvent }) {
  const cfg = EVENT_CONFIG[event.type] ?? { label: event.type, color: "#94a3b8", dot: "#94a3b8" };
  return (
    <div style={{
      display: "flex", alignItems: "flex-start", gap: 14,
      padding: "12px 0",
      borderBottom: "1px solid #1e2235",
    }}>
      {/* dot */}
      <div style={{
        width: 8, height: 8, borderRadius: "50%",
        background: cfg.dot, flexShrink: 0, marginTop: 5,
        boxShadow: `0 0 5px ${cfg.dot}60`,
      }} />
      {/* content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2, flexWrap: "wrap" }}>
          <span style={{
            fontSize: "0.65rem", fontWeight: 600,
            color: cfg.color,
            background: `${cfg.color}15`,
            padding: "1px 7px", borderRadius: 20,
            letterSpacing: "0.04em", textTransform: "uppercase",
            fontFamily: "monospace",
          }}>
            {cfg.label}
          </span>
          <span style={{ fontSize: "0.85rem", color: "#e2e8f0", fontWeight: 500 }}>
            {event.description}
          </span>
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: "0.72rem", color: "#475569", fontFamily: "monospace" }}>
            {event.filename}
          </span>
          {event.project && (
            <span style={{ fontSize: "0.72rem", color: "#334155" }}>
              {event.project}
            </span>
          )}
        </div>
      </div>
      {/* time */}
      <div style={{ flexShrink: 0, textAlign: "right" }}>
        <div style={{ fontSize: "0.72rem", color: "#475569" }} title={formatFullTime(event.timestamp)}>
          {formatTime(event.timestamp)}
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   STAT CARD
   ============================================================ */
function StatCard({ value, label, color, sublabel }: {
  value: number; label: string; color: string; sublabel?: string;
}) {
  return (
    <div style={{
      background: "#0d0f1a",
      border: "1px solid #1e2235",
      borderRadius: 12,
      padding: "18px 20px",
      flex: 1,
    }}>
      <div style={{ fontSize: "1.8rem", fontWeight: 700, color, lineHeight: 1, marginBottom: 6, fontVariantNumeric: "tabular-nums" }}>
        {value}
      </div>
      <div style={{ fontSize: "0.82rem", color: "#94a3b8", fontWeight: 500 }}>{label}</div>
      {sublabel && <div style={{ fontSize: "0.68rem", color: "#334155", marginTop: 3 }}>{sublabel}</div>}
    </div>
  );
}

/* ============================================================
   LIVE SUMMARY PANEL
   ============================================================ */
function buildLocalSummary(events: ActivityEvent[]): string {
  if (events.length === 0) return "No activity yet.";

  const accepts = events.filter(e => e.type === "accept");
  const rejects = events.filter(e => e.type === "reject");
  const totalLines = accepts.reduce((s, e) => s + (e.linesChanged ?? 0), 0);
  const uniqueFiles = [...new Set(accepts.map(e => e.filename))];
  const projects = [...new Set(events.map(e => e.project).filter(Boolean))];

  const rate = accepts.length + rejects.length > 0
    ? Math.round((accepts.length / (accepts.length + rejects.length)) * 100)
    : 0;

  const recentAccepts = accepts.slice(0, 5);

  let summary = `## Session Summary\n\n`;
  summary += `**${accepts.length}** AI suggestions accepted across **${uniqueFiles.length}** file${uniqueFiles.length !== 1 ? "s" : ""}, `;
  summary += `totalling ~**${totalLines}** lines changed.\n\n`;
  summary += `Accept rate: **${rate}%** (${accepts.length} accepted / ${rejects.length} rejected).\n\n`;

  if (projects.length) {
    summary += `**Projects:** ${projects.join(", ")}.\n\n`;
  }

  if (uniqueFiles.length) {
    summary += `**Most-edited files:**\n${uniqueFiles.slice(0, 6).map(f => `- \`${f}\``).join("\n")}\n\n`;
  }

  if (recentAccepts.length) {
    summary += `**Recent commits:**\n${recentAccepts.map(e => `- ${e.description} (\`${e.filename}\`)`).join("\n")}\n`;
  }

  return summary;
}

function SummaryPanel({ events, onClose }: { events: ActivityEvent[]; onClose: () => void }) {
  const [text, setText] = useState<string>("");
  const [streaming, setStreaming] = useState<boolean>(true);
  const fullText = useRef<string>("");
  const charIdx = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fullText.current = buildLocalSummary(events);
    charIdx.current = 0;
    setText("");
    setStreaming(true);

    timerRef.current = setInterval(() => {
      charIdx.current += 3;
      setText(fullText.current.slice(0, charIdx.current));
      if (charIdx.current >= fullText.current.length) {
        clearInterval(timerRef.current!);
        setStreaming(false);
      }
    }, 18);

    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [events]);

  const renderMd = (raw: string) => raw.split("\n").map((line, i) => {
    if (line.startsWith("## ")) return <div key={i} style={{ fontSize: "1rem", fontWeight: 700, color: "#e2e8f0", marginBottom: 12, marginTop: 4 }}>{line.slice(3)}</div>;
    if (line.startsWith("**") && line.endsWith("**")) {
      return <div key={i} style={{ fontSize: "0.82rem", color: "#4ade80", fontWeight: 600, marginBottom: 6 }}>{line.slice(2, -2)}</div>;
    }
    if (line.startsWith("- ")) return <div key={i} style={{ fontSize: "0.82rem", color: "#94a3b8", marginBottom: 4, paddingLeft: 12 }}>· {line.slice(2)}</div>;
    if (line.trim() === "") return <div key={i} style={{ height: 6 }} />;
    // inline bold
    const parts = line.split(/(\*\*[^*]+\*\*)/g);
    return (
      <div key={i} style={{ fontSize: "0.82rem", color: "#94a3b8", marginBottom: 4, lineHeight: 1.65 }}>
        {parts.map((p, j) =>
          p.startsWith("**") && p.endsWith("**")
            ? <strong key={j} style={{ color: "#e2e8f0" }}>{p.slice(2, -2)}</strong>
            : <span key={j}>{p}</span>
        )}
      </div>
    );
  });

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 200,
      background: "rgba(8,10,18,0.82)",
      backdropFilter: "blur(8px)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 24,
      animation: "dbFadeIn 0.2s ease forwards",
    }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        width: "min(680px, 100%)",
        maxHeight: "80vh",
        background: "#0d0f1a",
        border: "1px solid #1e2235",
        borderRadius: 14,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        boxShadow: "0 32px 80px rgba(0,0,0,0.7), 0 0 0 1px rgba(74,222,128,0.08)",
      }}>
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "0 18px", height: 44, flexShrink: 0,
          background: "#080a12", borderBottom: "1px solid #1e2235",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{
              width: 18, height: 18, borderRadius: 4,
              background: "linear-gradient(135deg, #22c55e, #4ade80)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: "0.58rem", flexShrink: 0,
            }}>✦</div>
            <span style={{ fontSize: "0.82rem", color: "#e2e8f0", fontWeight: 600 }}>Commit Summary</span>
            {streaming && (
              <div style={{ display: "flex", gap: 3, alignItems: "center", marginLeft: 4 }}>
                {[0,1,2].map(i => (
                  <div key={i} style={{
                    width: 4, height: 4, borderRadius: "50%",
                    background: "#4ade80",
                    animation: `dbDot 1s ease-in-out infinite ${i * 0.2}s`,
                  }} />
                ))}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            style={{
              background: "transparent", border: "1px solid #1e2235",
              color: "#475569", borderRadius: 5, padding: "3px 10px",
              fontSize: "0.72rem", cursor: "pointer", transition: "all 0.15s",
            }}
            onMouseEnter={e => { e.currentTarget.style.color = "#e2e8f0"; e.currentTarget.style.borderColor = "#334155"; }}
            onMouseLeave={e => { e.currentTarget.style.color = "#475569"; e.currentTarget.style.borderColor = "#1e2235"; }}
          >
            ✕ close
          </button>
        </div>
        {/* Body */}
        <div style={{ flex: 1, overflow: "auto", padding: "20px 22px" }}>
          {renderMd(text)}
          {streaming && <span style={{ display: "inline-block", width: 2, height: "0.9em", background: "#4ade80", animation: "dbBlink 0.9s step-end infinite", verticalAlign: "text-bottom", marginLeft: 1 }} />}
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   MAIN DASHBOARD PAGE
   ============================================================ */
export default function DashboardPage() {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [contributionMap, setContributionMap] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState<string>("all");
  const [limit, setLimit] = useState<number>(5);
  const [summaryOpen, setSummaryOpen] = useState<boolean>(false);
  const days = lastNDays(371); // ~53 weeks (rounds to full grid)

  const refresh = useCallback(() => {
    const all = getActivities();
    setEvents([...all].reverse()); // newest first
    setContributionMap(getContributionMap());
  }, []);

  useEffect(() => {
    seedMockData(); // inject historical mock commits on first visit
    refresh();
    const handler = () => refresh();
    window.addEventListener("senorita-activity", handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener("senorita-activity", handler);
      window.removeEventListener("storage", handler);
    };
  }, [refresh]);

  // Derived stats
  const totalAccepts  = events.filter(e => e.type === "accept").length;
  const totalRejects  = events.filter(e => e.type === "reject").length;
  const totalCommits  = events.filter(e => e.type === "commit").length;
  const uniqueProjects = [...new Set(events.map(e => e.project).filter(Boolean))];
  // Show most-recent REAL (non-mock) project first, fall back to any
  const recentProject  = events.find(e => !e.id.startsWith("mock"))?.project
    || events[0]?.project
    || "No project opened yet";
  const acceptRate     = totalAccepts + totalRejects > 0
    ? Math.round((totalAccepts / (totalAccepts + totalRejects)) * 100)
    : 0;

  const filtered = (filter === "all" ? events : events.filter(e => e.type === filter));
  const displayedLogs = limit === 0 ? filtered : filtered.slice(0, limit);

  const FILTER_TABS = [
    { key: "all",       label: "All" },
    { key: "accept",    label: "Accepted" },
    { key: "reject",    label: "Rejected" },
    { key: "commit",    label: "Saved" },
    { key: "summarize", label: "Summaries" },
  ];

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #080a12; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #1e2235; border-radius: 3px; }
        ::-webkit-scrollbar-thumb:hover { background: #2d3555; }
        @keyframes dbFadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes dbBlink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
        @keyframes dbDot {
          0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
          40% { transform: scale(1); opacity: 1; }
        }
        .db-anim { animation: dbFadeIn 0.35s ease forwards; }
        .db-filter-btn:hover { border-color: #334155 !important; color: #cbd5e1 !important; }
        .db-clear-btn:hover { border-color: rgba(248,113,113,0.4) !important; color: #f87171 !important; }
        .db-nav-link:hover { color: #4ade80 !important; }
      `}</style>

      <div style={{
        minHeight: "100vh",
        background: "#080a12",
        fontFamily: "Inter, system-ui, sans-serif",
        color: "#cbd5e1",
      }}>

        {/* ── Top nav ── */}
        <nav style={{
          borderBottom: "1px solid #1e2235",
          background: "#080a12",
          position: "sticky", top: 0, zIndex: 100,
          backdropFilter: "blur(8px)",
        }}>
          <div style={{
            maxWidth: 1100, margin: "0 auto",
            padding: "0 24px", height: 100,
            display: "flex", alignItems: "center", justifyContent: "space-between",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
              {/* Logo */}
              <img src="/logo3.png" alt="Señorita" style={{ width: 200, height: "auto", objectFit: "contain", display: "block", flexShrink: 0, mixBlendMode: "screen" }} />
              <span style={{ fontSize: "0.9rem", fontWeight: 600, color: "#e2e8f0" }}>
                Senorita
              </span>
              <span style={{ color: "#1e2235" }}>|</span>
              <span style={{ fontSize: "0.82rem", color: "#475569" }}>Dashboard</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <Link
                href="/editor"
                className="db-nav-link"
                style={{
                  fontSize: "0.82rem", color: "#475569",
                  textDecoration: "none", transition: "color 0.15s",
                  display: "flex", alignItems: "center", gap: 5,
                }}
              >
                <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
                  <polyline points="3,7 1,6.5 3,6" />
                  <path d="M1 6.5 C3 2 10 2 12 6.5" />
                  <rect x="4" y="4" width="5" height="7" rx="1" />
                </svg>
                Open Editor
              </Link>
            </div>
          </div>
        </nav>

        <div style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 24px 64px" }}>

          {/* ── Header ── */}
          <div className="db-anim" style={{ marginBottom: 32, animationDelay: "0s" }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
              <div>
                <h1 style={{
                  fontSize: "1.35rem", fontWeight: 700,
                  color: "#e2e8f0", marginBottom: 6,
                }}>
                  Developer Activity
                </h1>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{
                    width: 8, height: 8, borderRadius: "50%",
                    background: "#4ade80",
                    boxShadow: "0 0 6px #4ade8080",
                  }} />
                  <span style={{ fontSize: "0.82rem", color: "#475569" }}>
                    Active project:&nbsp;
                    <span style={{ color: "#94a3b8", fontWeight: 500, fontFamily: "monospace", fontSize: "0.78rem" }}>
                      {recentProject}
                    </span>
                  </span>
                </div>
              </div>

              {events.length > 0 && (
                <button
                  className="db-clear-btn"
                  onClick={() => { clearActivities(); refresh(); }}
                  style={{
                    background: "transparent",
                    border: "1px solid #1e2235",
                    color: "#475569",
                    borderRadius: 7, padding: "6px 14px",
                    fontSize: "0.75rem", cursor: "pointer",
                    transition: "all 0.15s",
                  }}
                >
                  Clear history
                </button>
              )}
            </div>
          </div>

          {/* ── Stats row ── */}
          <div className="db-anim" style={{ display: "flex", gap: 12, marginBottom: 32, flexWrap: "wrap", animationDelay: "0.05s" }}>
            <StatCard value={totalAccepts}  label="Accepted changes"  color="#4ade80" sublabel="AI suggestions merged" />
            <StatCard value={totalRejects}  label="Rejected changes"  color="#4ade80" sublabel="AI suggestions declined" />
            <StatCard value={totalCommits}  label="Files saved"       color="#4ade80" sublabel="Manual saves" />
            <StatCard value={acceptRate}    label="Accept rate"       color="#4ade80" sublabel="% of suggestions kept" />
          </div>

          {/* ── Projects row ── */}
          {uniqueProjects.length > 0 && (
            <div className="db-anim" style={{ marginBottom: 32, animationDelay: "0.07s" }}>
              <div style={{
                background: "#0d0f1a",
                border: "1px solid #1e2235",
                borderRadius: 12,
                padding: "16px 20px",
              }}>
                <div style={{ fontSize: "0.68rem", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "#475569", marginBottom: 12 }}>
                  Projects
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {uniqueProjects.map((p, i) => (
                    <div key={i} style={{
                      display: "flex", alignItems: "center", gap: 7,
                      background: "#13151f", border: "1px solid #1e2235",
                      borderRadius: 8, padding: "6px 12px",
                    }}>
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="#475569" strokeWidth="1.4" strokeLinecap="round">
                        <path d="M2 2h8v8H2z" />
                        <path d="M4 2v8M2 5h8" />
                      </svg>
                      <span style={{ fontSize: "0.8rem", color: "#94a3b8", fontFamily: "monospace" }}>{p}</span>
                      <span style={{
                        fontSize: "0.62rem", color: "#4ade80",
                        background: "rgba(74,222,128,0.1)",
                        padding: "1px 6px", borderRadius: 10,
                      }}>
                        {events.filter(e => e.project === p && e.type === "accept").length} edits
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── Contribution grid ── */}
          <div className="db-anim" style={{
            background: "#0d0f1a",
            border: "1px solid #1e2235",
            borderRadius: 14,
            padding: "24px",
            marginBottom: 32,
            animationDelay: "0.1s",
          }}>
            <ContributionGrid contributionMap={contributionMap} days={days} />
          </div>

          {/* ── Activity log ── */}
          <div className="db-anim" style={{ animationDelay: "0.15s" }}>
            <div style={{
              display: "flex", alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 16, flexWrap: "wrap", gap: 10,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ fontSize: "0.68rem", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "#475569" }}>
                  Activity Log
                </div>
                {/* Summaries button */}
                <button
                  onClick={() => setSummaryOpen(true)}
                  style={{
                    display: "flex", alignItems: "center", gap: 6,
                    background: "rgba(74,222,128,0.08)",
                    border: "1px solid rgba(74,222,128,0.25)",
                    borderRadius: 7, padding: "5px 13px",
                    fontSize: "0.73rem", cursor: "pointer",
                    color: "#4ade80", fontWeight: 500,
                    transition: "all 0.15s",
                    fontFamily: "Inter, system-ui, sans-serif",
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.background = "rgba(74,222,128,0.14)";
                    e.currentTarget.style.borderColor = "rgba(74,222,128,0.45)";
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = "rgba(74,222,128,0.08)";
                    e.currentTarget.style.borderColor = "rgba(74,222,128,0.25)";
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <path d="M1 2h10M1 5h7M1 8h9M1 11h5" />
                  </svg>
                  Summaries
                </button>
              </div>
              {/* Top-N dropdown + Filter tabs */}
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <select
                  value={limit}
                  onChange={e => setLimit(Number(e.target.value))}
                  style={{
                    background: "#0d0f1a",
                    border: "1px solid #1e2235",
                    borderRadius: 6,
                    color: "#94a3b8",
                    fontSize: "0.72rem",
                    padding: "4px 8px",
                    cursor: "pointer",
                    outline: "none",
                    fontFamily: "Inter, system-ui, sans-serif",
                  }}
                >
                  {[5, 10, 15, 20, 50].map(n => (
                    <option key={n} value={n}>Top {n}</option>
                  ))}
                  <option value={0}>All</option>
                </select>
              <div style={{ display: "flex", gap: 4 }}>
                {FILTER_TABS.map(tab => (
                  <button
                    key={tab.key}
                    className="db-filter-btn"
                    onClick={() => setFilter(tab.key)}
                    style={{
                      background: filter === tab.key ? "#1e2235" : "transparent",
                      border: `1px solid ${filter === tab.key ? "#2d3555" : "#1e2235"}`,
                      color: filter === tab.key ? "#e2e8f0" : "#475569",
                      borderRadius: 6, padding: "4px 11px",
                      fontSize: "0.72rem", cursor: "pointer",
                      transition: "all 0.15s",
                    }}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              </div>
            </div>

            <div style={{
              background: "#0d0f1a",
              border: "1px solid #1e2235",
              borderRadius: 12,
              padding: "0 20px",
              minHeight: 120,
            }}>
              {filtered.length === 0 ? (
                <div style={{
                  display: "flex", flexDirection: "column",
                  alignItems: "center", justifyContent: "center",
                  padding: "48px 24px", gap: 10,
                }}>
                  <div style={{
                    width: 40, height: 40, borderRadius: "50%",
                    background: "#13151f", border: "1px solid #1e2235",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: "1.2rem",
                  }}>
                    📋
                  </div>
                  <div style={{ fontSize: "0.88rem", color: "#475569" }}>
                    No activity yet
                  </div>
                  <div style={{ fontSize: "0.75rem", color: "#334155" }}>
                    Accept or reject AI suggestions in the editor to see activity here
                  </div>
                  <Link
                    href="/editor"
                    style={{
                      marginTop: 8,
                      fontSize: "0.78rem", color: "#38bdf8",
                      textDecoration: "none",
                      border: "1px solid rgba(56,189,248,0.25)",
                      padding: "6px 14px", borderRadius: 7,
                    }}
                  >
                    Open Editor →
                  </Link>
                </div>
              ) : (
                <>
                  {displayedLogs.map(e => <LogRow key={e.id} event={e} />)}
                  {filtered.length > displayedLogs.length && (
                    <div style={{
                      padding: "10px 0",
                      textAlign: "center",
                      fontSize: "0.72rem",
                      color: "#334155",
                      borderTop: "1px solid #1e2235",
                      marginTop: 2,
                    }}>
                      {filtered.length - displayedLogs.length} more entries hidden — increase limit to show more
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

        </div>
      </div>

      {/* ── Live Summary Panel ── */}
      {summaryOpen && (
        <SummaryPanel
          events={events}
          onClose={() => setSummaryOpen(false)}
        />
      )}
    </>
  );
}
