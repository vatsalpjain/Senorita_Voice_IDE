"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { loadWorkspace, onWorkspaceChange, WorkspaceContext } from "../../store/workspaceStore";

/* ============================================================
   TYPES
   ============================================================ */
interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  diagrams?: DiagramData[];
  summary?: SummaryData;
  filesReferenced?: string[];
  functions?: FunctionData[];
}

interface ChatSession {
  id: string;
  title: string;
  preview: string;
  timestamp: Date;
}

interface DiagramData {
  id: string;
  title: string;
  type: string;
  definition: string;
}

interface SummaryData {
  overview: string;
  keyPoints: string[];
  complexity: "low" | "medium" | "high";
  linesAnalyzed: number;
}

interface FunctionData {
  name: string;
  signature: string;
  description: string;
  file: string;
  lineStart: number;
  lineEnd: number;
}

/* ============================================================
   CONSTANTS
   ============================================================ */
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

/* ============================================================
   GLOBAL STYLES
   ============================================================ */
const GlobalStyles = (): React.ReactElement => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=DM+Sans:ital,wght@0,300;0,400;0,500;1,300&family=JetBrains+Mono:wght@400;500&display=swap');
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --void: #07090E; --surface: #0C0F18; --panel: #111520;
      --border: #1A2033; --cyan-core: #00D4E8; --cyan-bright: #00FFFF;
    }
    html { scroll-behavior: smooth; }
    body { background: var(--void); color: #C8D5E8; font-family: 'DM Sans', sans-serif; overflow-x: hidden; cursor: none; }
    .cursor-dot { position: fixed; top: 0; left: 0; z-index: 9999; width: 8px; height: 8px; background: var(--cyan-bright); border-radius: 50%; pointer-events: none; transition: transform 0.1s ease; box-shadow: 0 0 12px var(--cyan-core), 0 0 24px rgba(0,212,232,0.4); }
    .cursor-ring { position: fixed; top: 0; left: 0; z-index: 9998; width: 32px; height: 32px; border: 1px solid rgba(0,212,232,0.4); border-radius: 50%; pointer-events: none; transition: transform 0.15s ease; }
    @keyframes fadeUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
    @keyframes shimmer { 0% { background-position: -200% center; } 100% { background-position: 200% center; } }
    @keyframes pulseGlow { 0%,100% { box-shadow: 0 0 20px rgba(0,212,232,0.2); } 50% { box-shadow: 0 0 40px rgba(0,212,232,0.4); } }
    @keyframes blink { 0%,100% { opacity: 1; } 50% { opacity: 0; } }
    @keyframes popIn { 0% { opacity: 0; transform: scale(0.96) translateY(8px); } 100% { opacity: 1; transform: scale(1) translateY(0); } }
    .animate-fade-up { animation: fadeUp 0.5s ease forwards; }
    .animate-fade-in { animation: fadeIn 0.5s ease forwards; }
    .animate-pop-in { animation: popIn 0.35s ease forwards; }
    .font-display { font-family: 'Syne', sans-serif; }
    .font-mono { font-family: 'JetBrains Mono', monospace; }
    ::-webkit-scrollbar { width: 4px; height: 4px; }
    ::-webkit-scrollbar-track { background: var(--void); }
    ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }
    .gradient-text { background: linear-gradient(135deg, #00FFFF 0%, #4DD9E8 40%, #8A9BB8 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
    .shimmer-text { background: linear-gradient(90deg, #8A9BB8 0%, #00FFFF 30%, #4DD9E8 50%, #00FFFF 70%, #8A9BB8 100%); background-size: 200% auto; -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; animation: shimmer 3s linear infinite; }
    .sidebar-item { padding: 10px 14px; border-radius: 8px; cursor: none; transition: background 0.2s, border-color 0.2s; border: 1px solid transparent; }
    .sidebar-item:hover { background: rgba(0,212,232,0.05); border-color: rgba(0,212,232,0.12); }
    .sidebar-item.active { background: rgba(0,212,232,0.08); border-color: rgba(0,212,232,0.2); }
    .action-btn { display: flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 8px; border: 1px solid #1A2033; background: transparent; color: #8A9BB8; font-family: 'DM Sans', sans-serif; font-size: 0.8rem; cursor: none; transition: all 0.2s; white-space: nowrap; }
    .action-btn:hover { border-color: rgba(0,212,232,0.3); color: #00D4E8; background: rgba(0,212,232,0.05); }
    .diagram-tab { padding: 6px 14px; border-radius: 6px; font-size: 0.78rem; cursor: none; transition: all 0.2s; border: 1px solid transparent; font-family: 'DM Sans', sans-serif; background: transparent; }
    .diagram-tab:hover { background: rgba(0,212,232,0.05); border-color: rgba(0,212,232,0.12); color: #C8D5E8; }
    .diagram-tab.active { background: rgba(0,212,232,0.1); border-color: rgba(0,212,232,0.25); color: #00D4E8; }
    .chat-input { width: 100%; background: transparent; border: none; outline: none; color: #C8D5E8; font-family: 'DM Sans', sans-serif; font-size: 0.95rem; resize: none; line-height: 1.6; }
    .chat-input::placeholder { color: #3A4560; }
    .file-chip { display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px; border-radius: 5px; background: rgba(0,212,232,0.06); border: 1px solid rgba(0,212,232,0.14); font-size: 0.75rem; font-family: 'JetBrains Mono', monospace; color: #4DD9E8; transition: all 0.2s; cursor: none; }
    .file-chip:hover { background: rgba(0,212,232,0.12); border-color: rgba(0,212,232,0.28); }
    .func-card { border: 1px solid #1A2033; border-radius: 10px; padding: 14px 16px; background: #0C0F18; transition: all 0.2s; cursor: none; }
    .func-card:hover { border-color: rgba(0,212,232,0.2); background: #111520; }
    .mermaid-container svg { max-width: 100%; height: auto; }
  `}</style>
);

/* ============================================================
   CUSTOM CURSOR
   ============================================================ */
const CustomCursor = (): React.ReactElement => {
  const dotRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const pos = useRef({ x: 0, y: 0 });
  const ringPos = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const move = (e: MouseEvent) => {
      pos.current = { x: e.clientX, y: e.clientY };
      if (dotRef.current) dotRef.current.style.transform = `translate(${e.clientX - 4}px, ${e.clientY - 4}px)`;
    };
    let raf: number;
    const animate = () => {
      ringPos.current.x += (pos.current.x - ringPos.current.x) * 0.12;
      ringPos.current.y += (pos.current.y - ringPos.current.y) * 0.12;
      if (ringRef.current) ringRef.current.style.transform = `translate(${ringPos.current.x - 16}px, ${ringPos.current.y - 16}px)`;
      raf = requestAnimationFrame(animate);
    };
    window.addEventListener("mousemove", move);
    raf = requestAnimationFrame(animate);
    return () => { window.removeEventListener("mousemove", move); cancelAnimationFrame(raf); };
  }, []);

  return (
    <>
      <div ref={dotRef} className="cursor-dot" />
      <div ref={ringRef} className="cursor-ring" />
    </>
  );
};

/* ============================================================
   MERMAID DIAGRAM RENDERER  (with zoom + pan + download)
   ============================================================ */
const MermaidDiagram = ({ definition, id, title }: { definition: string; id: string; title?: string }): React.ReactElement => {
  const svgWrapRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [rendered, setRendered] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragging = useRef(false);
  const dragStart = useRef({ mx: 0, my: 0, px: 0, py: 0 });

  useEffect(() => {
    let cancelled = false;
    setRendered(false);
    setError(null);
    setZoom(1);
    setPan({ x: 0, y: 0 });
    const render = async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: "dark",
          themeVariables: {
            background: "#0C0F18",
            primaryColor: "#00D4E8",
            primaryTextColor: "#C8D5E8",
            primaryBorderColor: "#1A2033",
            lineColor: "#3A5070",
            secondaryColor: "#111520",
            tertiaryColor: "#0C0F18",
            fontSize: "13px",
          },
        });
        const uniqueId = `mermaid-${id}-${Math.random().toString(36).slice(2)}`;
        const { svg } = await mermaid.render(uniqueId, definition);
        if (!cancelled && svgWrapRef.current) {
          svgWrapRef.current.innerHTML = svg;
          const svgEl = svgWrapRef.current.querySelector("svg");
          if (svgEl) {
            svgEl.style.maxWidth = "none";
            svgEl.style.width = "100%";
            svgEl.style.height = "auto";
          }
          setRendered(true);
        }
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    };
    render();
    return () => { cancelled = true; };
  }, [definition, id]);

  /* ── Wheel zoom ── */
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setZoom(z => Math.min(6, Math.max(0.2, z - e.deltaY * 0.001)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [rendered]);

  /* ── Drag pan ── */
  const onMouseDown = (e: React.MouseEvent) => {
    dragging.current = true;
    dragStart.current = { mx: e.clientX, my: e.clientY, px: pan.x, py: pan.y };
  };
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      setPan({ x: dragStart.current.px + e.clientX - dragStart.current.mx, y: dragStart.current.py + e.clientY - dragStart.current.my });
    };
    const onUp = () => { dragging.current = false; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, []);

  /* ── Download SVG ── */
  const downloadSvg = () => {
    const svgEl = svgWrapRef.current?.querySelector("svg");
    if (!svgEl) return;
    const blob = new Blob([svgEl.outerHTML], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(title ?? id).replace(/\s+/g, "-").toLowerCase()}.svg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  /* ── Download PNG ── */
  const downloadPng = () => {
    const svgEl = svgWrapRef.current?.querySelector("svg");
    if (!svgEl) return;
    const svgData = new XMLSerializer().serializeToString(svgEl);
    const canvas = document.createElement("canvas");
    const scale = 2;
    const bbox = svgEl.getBoundingClientRect();
    canvas.width = bbox.width * scale;
    canvas.height = bbox.height * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(scale, scale);
    ctx.fillStyle = "#0A0D16";
    ctx.fillRect(0, 0, bbox.width, bbox.height);
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, bbox.width, bbox.height);
      const a = document.createElement("a");
      a.download = `${(title ?? id).replace(/\s+/g, "-").toLowerCase()}.png`;
      a.href = canvas.toDataURL("image/png");
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    };
    img.src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svgData)));
  };

  const zoomBtnStyle = (active?: boolean): React.CSSProperties => ({
    display: "flex", alignItems: "center", justifyContent: "center",
    width: 28, height: 28, borderRadius: 6,
    background: active ? "rgba(0,212,232,0.12)" : "rgba(255,255,255,0.03)",
    border: `1px solid ${active ? "rgba(0,212,232,0.3)" : "#1A2033"}`,
    color: active ? "#00D4E8" : "#5A6888",
    cursor: "pointer", transition: "all 0.15s", fontSize: "0.75rem",
    fontFamily: "'JetBrains Mono', monospace", flexShrink: 0,
  });

  if (error) {
    return (
      <div style={{ padding: 20, color: "#FF5F57", fontSize: "0.8rem", fontFamily: "'JetBrains Mono', monospace" }}>
        ⚠ Render error: {error}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* ── Toolbar ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", borderBottom: "1px solid #0F1420", background: "#060810", flexShrink: 0, flexWrap: "wrap" }}>
        {/* Zoom controls */}
        <button style={zoomBtnStyle()} onClick={() => setZoom(z => Math.min(6, z + 0.25))} title="Zoom in">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
        </button>
        <button style={zoomBtnStyle()} onClick={() => setZoom(z => Math.max(0.2, z - 0.25))} title="Zoom out">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
        </button>
        <button style={zoomBtnStyle()} onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} title="Reset view">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
        </button>
        <span style={{ color: "#2A3555", fontSize: "0.68rem", fontFamily: "'JetBrains Mono', monospace", minWidth: 36, textAlign: "center" }}>
          {Math.round(zoom * 100)}%
        </span>
        <div style={{ flex: 1 }} />
        {/* Download buttons */}
        <button style={{ ...zoomBtnStyle(), width: "auto", padding: "0 10px", gap: 5 }} onClick={downloadSvg} title="Download as SVG">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          <span style={{ fontSize: "0.7rem" }}>SVG</span>
        </button>
        <button style={{ ...zoomBtnStyle(), width: "auto", padding: "0 10px", gap: 5, color: "#00D4E8", borderColor: "rgba(0,212,232,0.2)", background: "rgba(0,212,232,0.06)" }} onClick={downloadPng} title="Download as PNG">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          <span style={{ fontSize: "0.7rem" }}>PNG</span>
        </button>
      </div>

      {/* ── Diagram viewport ── */}
      <div
        ref={containerRef}
        onMouseDown={onMouseDown}
        style={{
          flex: 1, minHeight: 280, overflow: "hidden", position: "relative",
          cursor: dragging.current ? "grabbing" : "grab",
          background: "#0A0D16",
          userSelect: "none",
        }}
      >
        {!rendered && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#2A3555", fontSize: "0.8rem", fontFamily: "'JetBrains Mono', monospace" }}>
            Rendering diagram...
          </div>
        )}
        <div
          ref={svgWrapRef}
          style={{
            display: "inline-block",
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: "center center",
            transition: dragging.current ? "none" : "transform 0.05s ease",
            padding: "20px 16px",
            opacity: rendered ? 1 : 0,
            minWidth: "100%",
          }}
        />
      </div>

      {/* Hint */}
      <div style={{ padding: "4px 12px 6px", background: "#060810", borderTop: "1px solid #0F1420", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ color: "#1A2533", fontSize: "0.65rem", fontFamily: "'JetBrains Mono', monospace" }}>scroll to zoom · drag to pan</span>
      </div>
    </div>
  );
};

/* ============================================================
   DIAGRAM PANEL
   ============================================================ */
const DiagramPanel = ({ diagrams }: { diagrams: DiagramData[] }): React.ReactElement => {
  const [activeIdx, setActiveIdx] = useState(0);
  const active = diagrams[activeIdx];

  return (
    <div style={{ border: "1px solid #1A2033", borderRadius: 12, overflow: "hidden", background: "#0A0D16" }}>
      {/* Tab bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "10px 14px", background: "#060810", borderBottom: "1px solid #0F1420", overflowX: "auto" }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3A4560" strokeWidth="2" style={{ flexShrink: 0, marginRight: 4 }}>
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
        </svg>
        {diagrams.map((d, i) => (
          <button key={d.id} onClick={() => setActiveIdx(i)} className={`diagram-tab ${activeIdx === i ? "active" : ""}`} style={{ color: activeIdx === i ? "#00D4E8" : "#5A6888" }}>
            {d.title}
          </button>
        ))}
      </div>
      {/* Diagram with built-in toolbar */}
      <MermaidDiagram key={active.id} definition={active.definition} id={active.id} title={active.title} />
    </div>
  );
};

/* ============================================================
   SUMMARY PANEL
   ============================================================ */
const SummaryPanel = ({ summary }: { summary: SummaryData }): React.ReactElement => {
  const complexityColor = { low: "#00E5A0", medium: "#FEBC2E", high: "#FF5F57" }[summary.complexity];
  return (
    <div style={{ border: "1px solid #1A2033", borderRadius: 12, overflow: "hidden", background: "#0A0D16" }}>
      <div style={{ padding: "12px 16px", background: "#060810", borderBottom: "1px solid #0F1420", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#00D4E8" strokeWidth="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
          </svg>
          <span className="font-display" style={{ color: "#C8D5E8", fontSize: "0.85rem", fontWeight: 700 }}>Summary</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ padding: "2px 8px", borderRadius: 4, background: `${complexityColor}18`, border: `1px solid ${complexityColor}40`, color: complexityColor, fontSize: "0.7rem", fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            {summary.complexity} complexity
          </span>
          <span className="font-mono" style={{ color: "#3A4560", fontSize: "0.72rem" }}>{summary.linesAnalyzed.toLocaleString()} lines</span>
        </div>
      </div>
      <div style={{ padding: "16px" }}>
        <p style={{ color: "#8A9BB8", fontSize: "0.85rem", lineHeight: 1.7, marginBottom: 14 }}>{summary.overview}</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {summary.keyPoints.map((point, i) => (
            <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <div style={{ width: 18, height: 18, borderRadius: 4, flexShrink: 0, background: "rgba(0,212,232,0.12)", border: "1px solid rgba(0,212,232,0.2)", display: "flex", alignItems: "center", justifyContent: "center", marginTop: 1 }}>
                <span className="font-mono" style={{ color: "#00D4E8", fontSize: "0.6rem" }}>{i + 1}</span>
              </div>
              <span style={{ color: "#6A7D9A", fontSize: "0.82rem", lineHeight: 1.6 }}>{point}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

/* ============================================================
   FILES PANEL
   ============================================================ */
const FilesPanel = ({ files }: { files: string[] }): React.ReactElement => (
  <div style={{ border: "1px solid #1A2033", borderRadius: 12, overflow: "hidden", background: "#0A0D16" }}>
    <div style={{ padding: "12px 16px", background: "#060810", borderBottom: "1px solid #0F1420", display: "flex", alignItems: "center", gap: 8 }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#00D4E8" strokeWidth="2">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      </svg>
      <span className="font-display" style={{ color: "#C8D5E8", fontSize: "0.85rem", fontWeight: 700 }}>Files Referenced</span>
      <span style={{ marginLeft: "auto", padding: "1px 7px", borderRadius: 4, background: "rgba(0,212,232,0.08)", border: "1px solid rgba(0,212,232,0.16)", color: "#00D4E8", fontSize: "0.7rem", fontFamily: "'JetBrains Mono', monospace" }}>{files.length}</span>
    </div>
    <div style={{ padding: "14px 16px", display: "flex", flexWrap: "wrap", gap: 8 }}>
      {files.map((file) => (
        <span key={file} className="file-chip">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
          {file}
        </span>
      ))}
    </div>
  </div>
);

/* ============================================================
   FUNCTIONS PANEL
   ============================================================ */
const FunctionsPanel = ({ functions }: { functions: FunctionData[] }): React.ReactElement => (
  <div style={{ border: "1px solid #1A2033", borderRadius: 12, overflow: "hidden", background: "#0A0D16" }}>
    <div style={{ padding: "12px 16px", background: "#060810", borderBottom: "1px solid #0F1420", display: "flex", alignItems: "center", gap: 8 }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#00D4E8" strokeWidth="2">
        <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
      </svg>
      <span className="font-display" style={{ color: "#C8D5E8", fontSize: "0.85rem", fontWeight: 700 }}>Functions</span>
      <span style={{ marginLeft: "auto", padding: "1px 7px", borderRadius: 4, background: "rgba(0,212,232,0.08)", border: "1px solid rgba(0,212,232,0.16)", color: "#00D4E8", fontSize: "0.7rem", fontFamily: "'JetBrains Mono', monospace" }}>{functions.length}</span>
    </div>
    <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
      {functions.map((fn) => (
        <div key={fn.name} className="func-card">
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 6, gap: 12 }}>
            <span className="font-mono" style={{ color: "#00D4E8", fontSize: "0.82rem", fontWeight: 500 }}>{fn.name}</span>
            <span className="font-mono" style={{ color: "#2A3555", fontSize: "0.68rem", flexShrink: 0 }}>{fn.file}:{fn.lineStart}–{fn.lineEnd}</span>
          </div>
          <p className="font-mono" style={{ color: "#3A5070", fontSize: "0.72rem", marginBottom: 6, lineHeight: 1.5, wordBreak: "break-all" }}>{fn.signature}</p>
          <p style={{ color: "#6A7D9A", fontSize: "0.8rem", lineHeight: 1.55 }}>{fn.description}</p>
        </div>
      ))}
    </div>
  </div>
);

/* ============================================================
   ANALYSIS SECTION
   ============================================================ */
type AnalysisTab = "diagrams" | "summary" | "functions" | "files";

const AnalysisSection = ({ message }: { message: ChatMessage }): React.ReactElement => {
  const [activeTab, setActiveTab] = useState<AnalysisTab>("diagrams");

  const tabs: { id: AnalysisTab; label: string; count?: number }[] = [
    { id: "diagrams", label: "Flowcharts", count: message.diagrams?.length },
    { id: "summary", label: "Summary" },
    { id: "functions", label: "Functions", count: message.functions?.length },
    { id: "files", label: "Files", count: message.filesReferenced?.length },
  ];

  return (
    <div className="animate-fade-up" style={{ border: "1px solid #1A2033", borderRadius: 16, overflow: "hidden", background: "#080B12", marginTop: 4 }}>
      {/* Header + tabs */}
      <div style={{ padding: "12px 16px", background: "#060810", borderBottom: "1px solid #0F1420", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <div style={{ width: 22, height: 22, borderRadius: 6, background: "rgba(0,212,232,0.12)", border: "1px solid rgba(0,212,232,0.2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#00D4E8" strokeWidth="2.5"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
          </div>
          <span className="font-display" style={{ color: "#C8D5E8", fontSize: "0.85rem", fontWeight: 700 }}>Code Analysis</span>
          <span style={{ color: "#2A3555", fontSize: "0.72rem" }}>— auto-generated</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: "auto" }}>
          {tabs.map((tab) => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`diagram-tab ${activeTab === tab.id ? "active" : ""}`} style={{ color: activeTab === tab.id ? "#00D4E8" : "#5A6888", display: "flex", alignItems: "center", gap: 5 }}>
              {tab.label}
              {tab.count !== undefined && (
                <span style={{ padding: "0px 5px", borderRadius: 3, background: activeTab === tab.id ? "rgba(0,212,232,0.15)" : "rgba(255,255,255,0.04)", fontSize: "0.68rem", fontFamily: "'JetBrains Mono', monospace" }}>{tab.count}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div style={{ padding: "16px" }}>
        {activeTab === "diagrams" && message.diagrams && <DiagramPanel diagrams={message.diagrams} />}
        {activeTab === "summary" && message.summary && <SummaryPanel summary={message.summary} />}
        {activeTab === "functions" && message.functions && <FunctionsPanel functions={message.functions} />}
        {activeTab === "files" && message.filesReferenced && <FilesPanel files={message.filesReferenced} />}
      </div>
    </div>
  );
};

/* ============================================================
   CHAT MESSAGE BUBBLE
   ============================================================ */
const MessageBubble = ({ msg }: { msg: ChatMessage }): React.ReactElement => {
  const isUser = msg.role === "user";
  const hasAnalysis = msg.diagrams || msg.summary || msg.functions || msg.filesReferenced;

  return (
    <div className="animate-pop-in" style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: isUser ? "flex-end" : "flex-start" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, maxWidth: "85%", flexDirection: isUser ? "row-reverse" : "row" }}>
        {/* Avatar */}
        {!isUser && (
          <div style={{ flexShrink: 0, width: 28, height: 28, borderRadius: 8, background: "rgba(0,212,232,0.1)", border: "1px solid rgba(0,212,232,0.2)", display: "flex", alignItems: "center", justifyContent: "center", marginTop: 2 }}>
            <img src="/logo3.png" alt="Señorita" style={{ width: 20, height: 20, objectFit: "contain", mixBlendMode: "screen" }} />
          </div>
        )}
        {/* Bubble */}
        <div style={{
          padding: "12px 16px",
          borderRadius: isUser ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
          background: isUser ? "rgba(0,212,232,0.12)" : "#0C0F18",
          border: isUser ? "1px solid rgba(0,212,232,0.25)" : "1px solid #1A2033",
          color: "#C8D5E8",
          fontSize: "0.88rem",
          lineHeight: 1.65,
        }}>
          {msg.content}
        </div>
      </div>
      {/* Analysis block (assistant only) */}
      {!isUser && hasAnalysis && <AnalysisSection message={msg} />}
    </div>
  );
};

/* ============================================================
   MAIN PAGE
   ============================================================ */
export default function CopilotPage(): React.ReactElement {
  /* ── workspace context (from editor via localStorage) ── */
  const [workspace, setWorkspace] = useState<WorkspaceContext | null>(null);

  /* ── chat state ── */
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  /* ── Load workspace from localStorage and subscribe to updates ── */
  useEffect(() => {
    setWorkspace(loadWorkspace());
    const unsub = onWorkspaceChange((ctx) => setWorkspace(ctx));
    return unsub;
  }, []);

  const scrollToBottom = () => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  useEffect(() => { scrollToBottom(); }, [messages]);

  /* ── Build project context string to pass to backend with every request ── */
  const buildProjectContext = useCallback((): string => {
    if (!workspace) return "";
    const fileList = workspace.files.map(f => f.path).join(", ");
    const activeFile = workspace.activeFile ? `Currently open: ${workspace.activeFile.path}` : "";
    return `Project: ${workspace.folderName}\nFiles: ${fileList}\n${activeFile}`.trim();
  }, [workspace]);

  /* ── Core send handler — calls real backend ── */
  const handleSend = useCallback(async (overrideText?: string) => {
    const text = (overrideText ?? inputValue).trim();
    if (!text || isThinking) return;

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      content: text,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInputValue("");
    setIsThinking(true);
    if (textareaRef.current) textareaRef.current.style.height = "auto";

    /* Build session entry */
    let sessionId = activeSessionId;
    if (!sessionId) {
      sessionId = `s-${Date.now()}`;
      const newSession: ChatSession = {
        id: sessionId,
        title: text.length > 40 ? text.slice(0, 37) + "…" : text,
        preview: text,
        timestamp: new Date(),
      };
      setSessions((prev) => [newSession, ...prev]);
      setActiveSessionId(sessionId);
    }

    try {
      /* Call backend /api/command with full project context injected into the transcript */
      const projectCtx = buildProjectContext();
      const fullTranscript = projectCtx
        ? `[Project context]\n${projectCtx}\n\n[User question]\n${text}`
        : text;

      const res = await fetch(`${API_BASE}/api/command`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript: fullTranscript }),
      });

      let responseText = "";
      let diagrams: DiagramData[] | undefined;
      let summary: SummaryData | undefined;
      let filesReferenced: string[] | undefined;
      let functions: FunctionData[] | undefined;

      if (res.ok) {
        const data = await res.json();
        responseText = data.llm_response ?? data.instruction ?? data.text ?? "Done.";

        /* If user asked for flowchart / analysis, also hit the files list endpoint
           and generate a mermaid diagram from the file structure */
        const lc = text.toLowerCase();
        const wantsFlowchart = lc.includes("flowchart") || lc.includes("diagram") || lc.includes("flow");
        const wantsFunctions = lc.includes("function") || lc.includes("export") || lc.includes("list");
        const wantsSummary = lc.includes("summar") || lc.includes("overview") || lc.includes("explain") || lc.includes("analyz");
        const wantsFiles = lc.includes("file") || lc.includes("refer") || lc.includes("what files");

        /* Fetch registered files for analysis panels */
        let registeredFiles: Array<{ filename: string; path: string; language: string; size: number }> = [];
        try {
          const fr = await fetch(`${API_BASE}/api/files/list`);
          if (fr.ok) {
            const fd = await fr.json();
            registeredFiles = fd.files ?? [];
          }
        } catch { /* backend may not be running */ }

        if (registeredFiles.length > 0) {
          filesReferenced = registeredFiles.map(f => f.path);
        } else if (workspace?.files.length) {
          filesReferenced = workspace.files.map(f => f.path);
        }

        if (wantsFlowchart && workspace) {
          /* Build a real flowchart from the actual file structure */
          const folderName = workspace.folderName;
          const filesByDir: Record<string, string[]> = {};
          (registeredFiles.length > 0 ? registeredFiles.map(f => f.path) : workspace.files.map(f => f.path))
            .forEach(p => {
              const parts = p.split("/");
              const dir = parts.length > 1 ? parts[parts.length - 2] : folderName;
              if (!filesByDir[dir]) filesByDir[dir] = [];
              filesByDir[dir].push(parts[parts.length - 1]);
            });

          const dirs = Object.keys(filesByDir).slice(0, 8);
          let flowDef = `flowchart TD\n  ROOT([📁 ${folderName}])\n`;
          dirs.forEach((dir, i) => {
            const nodeId = `D${i}`;
            flowDef += `  ROOT --> ${nodeId}[📂 ${dir}]\n`;
            filesByDir[dir].slice(0, 4).forEach((file, j) => {
              flowDef += `  ${nodeId} --> F${i}_${j}([${file}])\n`;
            });
          });
          flowDef += `  style ROOT fill:#00D4E8,color:#07090E,stroke:none`;

          diagrams = [{
            id: "d-structure",
            title: "Project Structure",
            type: "flowchart",
            definition: flowDef,
          }];

          /* Add dependency flow if multiple dirs */
          if (dirs.length > 1) {
            const srcDirs = dirs.filter(d => ["services", "components", "hooks", "lib", "utils", "store"].includes(d));
            if (srcDirs.length >= 2) {
              let depDef = `flowchart LR\n`;
              srcDirs.forEach((dir, i) => {
                depDef += `  ${dir.toUpperCase().replace(/[^A-Z0-9]/g, "_")}[${dir}]\n`;
                if (i > 0) depDef += `  ${srcDirs[i - 1].toUpperCase().replace(/[^A-Z0-9]/g, "_")} --> ${dir.toUpperCase().replace(/[^A-Z0-9]/g, "_")}\n`;
              });
              diagrams.push({ id: "d-deps", title: "Layer Dependencies", type: "flowchart", definition: depDef });
            }
          }
        }

        if (wantsFunctions && registeredFiles.length > 0) {
          /* Extract function-like entries from registered file list */
          const codeFiles = registeredFiles.filter(f =>
            ["typescript", "javascript", "python"].includes(f.language)
          ).slice(0, 12);
          functions = codeFiles.map(f => ({
            name: f.filename.replace(/\.[^.]+$/, ""),
            signature: `// ${f.filename} (${f.language})`,
            description: `Registered file — ${f.size} bytes`,
            file: f.path,
            lineStart: 1,
            lineEnd: Math.round(f.size / 40),
          }));
        }

        if (wantsSummary && workspace) {
          const totalFiles = (registeredFiles.length > 0 ? registeredFiles : workspace.files).length;
          const langs = [...new Set(
            (registeredFiles.length > 0 ? registeredFiles.map(f => f.language) : workspace.files.map(f => f.language))
              .filter(Boolean)
          )];
          const totalSize = registeredFiles.reduce((s, f) => s + f.size, 0);
          summary = {
            overview: responseText || `Project "${workspace.folderName}" contains ${totalFiles} files across ${langs.join(", ")} languages.`,
            keyPoints: [
              `${totalFiles} total files registered in the workspace`,
              `Languages: ${langs.join(", ") || "various"}`,
              `Total code size: ~${Math.round(totalSize / 1024)} KB`,
              workspace.activeFile ? `Currently editing: ${workspace.activeFile.path}` : "No file currently open",
              workspace.openTabs.length > 0 ? `Open tabs: ${workspace.openTabs.map(t => t.name).join(", ")}` : "No tabs open",
            ],
            complexity: totalFiles > 30 ? "high" : totalFiles > 10 ? "medium" : "low",
            linesAnalyzed: Math.round(totalSize / 40),
          };
        }

        /* If specifically asked for files, always show them */
        if (wantsFiles && !filesReferenced) {
          filesReferenced = workspace?.files.map(f => f.path) ?? [];
        }

      } else {
        /* Backend error — show message but still show file context if available */
        responseText = `Backend returned ${res.status}. Make sure the backend is running at http://localhost:8000.`;
        if (workspace?.files.length) {
          filesReferenced = workspace.files.map(f => f.path);
        }
      }

      const aiMsg: ChatMessage = {
        id: `a-${Date.now()}`,
        role: "assistant",
        content: responseText,
        timestamp: new Date(),
        diagrams: diagrams?.length ? diagrams : undefined,
        summary,
        filesReferenced: filesReferenced?.length ? filesReferenced : undefined,
        functions: functions?.length ? functions : undefined,
      };
      setMessages((prev) => [...prev, aiMsg]);

    } catch (err) {
      /* Network error — backend likely not running */
      const errMsg = err instanceof Error ? err.message : String(err);
      const fallbackFiles = workspace?.files.map(f => f.path);
      setMessages((prev) => [...prev, {
        id: `a-${Date.now()}`,
        role: "assistant",
        content: `Could not reach backend (${errMsg}). Make sure the backend is running at http://localhost:8000.\n\n${workspace ? `Your workspace "${workspace.folderName}" has ${workspace.files.length} files loaded — the backend just needs to be started to analyse them.` : "No workspace loaded yet — open a folder in the Editor first."}`,
        timestamp: new Date(),
        filesReferenced: fallbackFiles?.length ? fallbackFiles : undefined,
      }]);
    } finally {
      setIsThinking(false);
    }
  }, [inputValue, isThinking, activeSessionId, workspace, buildProjectContext]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 160) + "px";
  };

  const startNewChat = () => {
    setActiveSessionId(null);
    setMessages([]);
    setInputValue("");
  };

  const formatTime = (d: Date) => {
    const diff = Date.now() - d.getTime();
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
  };

  /* ── Suggestion chips — personalised when workspace is loaded ── */
  const suggestions = workspace
    ? [
        `Summarize the ${workspace.folderName} project`,
        `Generate a flowchart of ${workspace.folderName}`,
        `List all exported functions`,
        workspace.activeFile ? `Explain ${workspace.activeFile.name}` : "What files are in this project?",
        `Show the file structure`,
      ]
    : [
        "Generate a flowchart of this project",
        "Summarize all files in /services",
        "List all exported functions",
        "Explain the WebSocket reconnect logic",
        "Show me the component hierarchy",
      ];

  const isEmpty = messages.length === 0;

  return (
    <>
      <GlobalStyles />
      <CustomCursor />

      <div style={{ display: "flex", height: "100vh", background: "#07090E", overflow: "hidden" }}>

        {/* ── SIDEBAR ── */}
        <aside style={{
          width: sidebarCollapsed ? 56 : 260,
          flexShrink: 0,
          background: "#0A0D16",
          borderRight: "1px solid #1A2033",
          display: "flex",
          flexDirection: "column",
          transition: "width 0.25s ease",
          overflow: "hidden",
        }}>
          {/* Sidebar header */}
          <div style={{ padding: "16px 12px", borderBottom: "1px solid #1A2033", display: "flex", alignItems: "center", justifyContent: "space-between", minHeight: 64 }}>
            {!sidebarCollapsed && (
              <img src="/logo3.png" alt="Señorita" style={{ width: 110, height: "auto", objectFit: "contain", mixBlendMode: "screen", flexShrink: 0 }} />
            )}
            <button onClick={() => setSidebarCollapsed((v) => !v)}
              style={{ background: "transparent", border: "1px solid #1A2033", borderRadius: 6, padding: 6, cursor: "none", color: "#5A6888", transition: "all 0.2s", marginLeft: sidebarCollapsed ? "auto" : 0, display: "flex", alignItems: "center" }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(0,212,232,0.3)"; e.currentTarget.style.color = "#00D4E8"; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#1A2033"; e.currentTarget.style.color = "#5A6888"; }}
            >
              {sidebarCollapsed
                ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6" /></svg>
                : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>
              }
            </button>
          </div>

          {/* New chat button */}
          <div style={{ padding: "12px 10px", borderBottom: "1px solid #0F1420" }}>
            <button onClick={startNewChat}
              style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: sidebarCollapsed ? "9px" : "9px 12px", borderRadius: 8, background: "rgba(0,212,232,0.07)", border: "1px solid rgba(0,212,232,0.15)", color: "#00D4E8", cursor: "none", fontSize: "0.82rem", fontFamily: "'DM Sans', sans-serif", transition: "all 0.2s", justifyContent: sidebarCollapsed ? "center" : "flex-start" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(0,212,232,0.12)"; e.currentTarget.style.borderColor = "rgba(0,212,232,0.3)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(0,212,232,0.07)"; e.currentTarget.style.borderColor = "rgba(0,212,232,0.15)"; }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
              {!sidebarCollapsed && "New chat"}
            </button>
          </div>

          {!sidebarCollapsed && (
            <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column" }}>

              {/* ── WORKSPACE SECTION ── */}
              <div style={{ padding: "10px 10px 0" }}>
                <div style={{ padding: "4px 6px 6px", color: "#2A3555", fontSize: "0.65rem", fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                  Workspace
                </div>
                {workspace ? (
                  <div style={{ border: "1px solid rgba(0,212,232,0.15)", borderRadius: 8, padding: "10px 12px", background: "rgba(0,212,232,0.04)", marginBottom: 8 }}>
                    {/* Folder name */}
                    <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 6 }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#00D4E8" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
                      <span style={{ color: "#00D4E8", fontSize: "0.82rem", fontWeight: 600, fontFamily: "'DM Sans', sans-serif", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{workspace.folderName}</span>
                    </div>
                    {/* Active file */}
                    {workspace.activeFile && (
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#00E5A0" strokeWidth="2"><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></svg>
                        <span style={{ color: "#00E5A0", fontSize: "0.73rem", fontFamily: "'JetBrains Mono', monospace", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{workspace.activeFile.name}</span>
                      </div>
                    )}
                    {/* File count */}
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ color: "#3A4560", fontSize: "0.68rem", fontFamily: "'JetBrains Mono', monospace" }}>{workspace.files.length} files indexed</span>
                      {workspace.openTabs.length > 0 && (
                        <span style={{ color: "#2A3555", fontSize: "0.65rem", fontFamily: "'JetBrains Mono', monospace" }}>· {workspace.openTabs.length} open</span>
                      )}
                    </div>
                    {/* File list (top 8) */}
                    {workspace.files.length > 0 && (
                      <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 2 }}>
                        {workspace.files.slice(0, 8).map((f) => (
                          <div key={f.path} style={{ display: "flex", alignItems: "center", gap: 5, padding: "2px 0" }}>
                            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#2A3555" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                            <span style={{ color: workspace.activeFile?.name === f.name ? "#00E5A0" : "#3A4560", fontSize: "0.68rem", fontFamily: "'JetBrains Mono', monospace", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{f.name}</span>
                          </div>
                        ))}
                        {workspace.files.length > 8 && (
                          <div style={{ color: "#2A3555", fontSize: "0.65rem", fontFamily: "'JetBrains Mono', monospace", paddingLeft: 14 }}>+{workspace.files.length - 8} more</div>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ border: "1px dashed #1A2033", borderRadius: 8, padding: "12px", marginBottom: 8, textAlign: "center" }}>
                    <div style={{ color: "#2A3555", fontSize: "0.75rem", fontFamily: "'DM Sans', sans-serif", marginBottom: 6 }}>No workspace open</div>
                    <Link href="/editor" style={{ textDecoration: "none" }}>
                      <span style={{ color: "#00D4E8", fontSize: "0.72rem", fontFamily: "'DM Sans', sans-serif", cursor: "none" }}>
                        Open folder in Editor →
                      </span>
                    </Link>
                  </div>
                )}
              </div>

              {/* ── CHAT SESSIONS ── */}
              <div style={{ padding: "0 10px 8px", display: "flex", flexDirection: "column", gap: 2 }}>
                {sessions.length > 0 && (
                  <div style={{ padding: "6px 6px 4px", color: "#2A3555", fontSize: "0.65rem", fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                    Recent chats
                  </div>
                )}
                {sessions.map((s) => (
                  <div key={s.id} className={`sidebar-item ${activeSessionId === s.id ? "active" : ""}`}
                    onClick={() => setActiveSessionId(s.id)}
                    style={{ display: "flex", flexDirection: "column", gap: 2 }}
                  >
                    <span style={{ color: activeSessionId === s.id ? "#C8D5E8" : "#8A9BB8", fontSize: "0.8rem", fontWeight: 500, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{s.title}</span>
                    <span style={{ color: "#2A3555", fontSize: "0.7rem", fontFamily: "'JetBrains Mono', monospace" }}>{formatTime(s.timestamp)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Bottom nav links */}
          {!sidebarCollapsed && (
            <div style={{ padding: "10px 10px 16px", borderTop: "1px solid #1A2033", display: "flex", flexDirection: "column", gap: 2 }}>
              {[
                { label: "Dashboard", href: "/dashboard", icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></svg> },
                { label: "IDE Editor", href: "/editor", icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></svg> },
                { label: "Home", href: "/", icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg> },
              ].map(({ label, href, icon }) => (
                <Link key={label} href={href} style={{ textDecoration: "none" }}>
                  <div className="sidebar-item" style={{ display: "flex", alignItems: "center", gap: 8, color: "#5A6888" }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.color = "#C8D5E8"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.color = "#5A6888"; }}
                  >
                    {icon}
                    <span style={{ fontSize: "0.8rem" }}>{label}</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </aside>

        {/* ── MAIN CONTENT ── */}
        <main style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", position: "relative" }}>

          {/* Top bar */}
          <div style={{ height: 56, flexShrink: 0, borderBottom: "1px solid #1A2033", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 24px", background: "rgba(10,13,22,0.6)", backdropFilter: "blur(12px)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span className="font-display" style={{ color: "#C8D5E8", fontSize: "0.9rem", fontWeight: 700 }}>Señorita AI</span>
              <span style={{ padding: "2px 8px", borderRadius: 4, background: "rgba(0,212,232,0.08)", border: "1px solid rgba(0,212,232,0.16)", color: "#00D4E8", fontSize: "0.68rem", fontFamily: "'JetBrains Mono', monospace" }}>Copilot</span>
              {/* Show active workspace in top bar */}
              {workspace && (
                <span style={{ display: "flex", alignItems: "center", gap: 5, padding: "2px 8px", borderRadius: 4, background: "rgba(0,229,160,0.06)", border: "1px solid rgba(0,229,160,0.15)", color: "#00E5A0", fontSize: "0.68rem", fontFamily: "'JetBrains Mono', monospace" }}>
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
                  {workspace.folderName}
                </span>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span className="font-mono" style={{ color: "#2A3555", fontSize: "0.72rem" }}>Model: Señorita-v1</span>
              <Link href="/editor" style={{ textDecoration: "none" }}>
                <button style={{ padding: "7px 16px", fontSize: "0.78rem", background: "transparent", border: "1px solid #3A5070", borderRadius: 7, color: "#C8D5E8", cursor: "none", fontFamily: "'DM Sans', sans-serif", transition: "all 0.2s" }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#00D4E8"; e.currentTarget.style.color = "#00D4E8"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#3A5070"; e.currentTarget.style.color = "#C8D5E8"; }}
                >
                  Open IDE →
                </button>
              </Link>
            </div>
          </div>

          {/* Chat area */}
          <div style={{ flex: 1, overflowY: "auto", padding: "0 0 8px" }}>

            {/* Empty state */}
            {isEmpty && (
              <div className="animate-fade-up" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "60vh", padding: "40px 24px", gap: 20 }}>
                <div style={{ position: "relative", marginBottom: 4 }}>
                  <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: 140, height: 140, background: "radial-gradient(circle, rgba(0,212,232,0.15) 0%, transparent 65%)", borderRadius: "50%", pointerEvents: "none" }} />
                  <img src="/logo3.png" alt="Señorita" style={{ width: 100, height: "auto", objectFit: "contain", mixBlendMode: "screen", position: "relative" }} />
                </div>
                <div style={{ textAlign: "center" }}>
                  <h1 className="font-display" style={{ fontSize: "1.8rem", fontWeight: 800, letterSpacing: "-0.03em", color: "#EEF4FF", marginBottom: 8 }}>
                    Ask <span className="gradient-text">Señorita</span> anything
                  </h1>
                  <p style={{ color: "#5A6888", fontSize: "0.9rem", maxWidth: 400 }}>
                    {workspace
                      ? `Analysing "${workspace.folderName}" — ${workspace.files.length} files loaded. Ask me anything about your project.`
                      : "Open a folder in the IDE Editor first, then ask me anything about your codebase."}
                  </p>
                </div>
                {/* Suggestion chips */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", maxWidth: 580 }}>
                  {suggestions.map((s) => (
                    <button key={s} onClick={() => { setInputValue(s); setTimeout(() => handleSend(s), 0); }}
                      style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid #1A2033", background: "#0C0F18", color: "#8A9BB8", fontSize: "0.8rem", cursor: "none", fontFamily: "'DM Sans', sans-serif", transition: "all 0.2s" }}
                      onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(0,212,232,0.25)"; e.currentTarget.style.color = "#C8D5E8"; e.currentTarget.style.background = "#111520"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#1A2033"; e.currentTarget.style.color = "#8A9BB8"; e.currentTarget.style.background = "#0C0F18"; }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Messages */}
            {!isEmpty && (
              <div style={{ maxWidth: 860, margin: "0 auto", padding: "24px 24px 8px", display: "flex", flexDirection: "column", gap: 20 }}>
                {messages.map((msg) => <MessageBubble key={msg.id} msg={msg} />)}
                {isThinking && (
                  <div className="animate-pop-in" style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                    <div style={{ width: 28, height: 28, borderRadius: 8, background: "rgba(0,212,232,0.1)", border: "1px solid rgba(0,212,232,0.2)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <img src="/logo3.png" alt="Señorita" style={{ width: 20, height: 20, objectFit: "contain", mixBlendMode: "screen" }} />
                    </div>
                    <div style={{ padding: "12px 16px", borderRadius: "14px 14px 14px 4px", background: "#0C0F18", border: "1px solid #1A2033", display: "flex", alignItems: "center", gap: 8 }}>
                      {[0, 1, 2].map((i) => (
                        <div key={i} style={{ width: 7, height: 7, borderRadius: "50%", background: "#00D4E8", animation: `blink 1.2s ease-in-out ${i * 0.2}s infinite` }} />
                      ))}
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {/* ── INPUT AREA ── */}
          <div style={{ padding: "12px 24px 20px", flexShrink: 0 }}>
            <div style={{ maxWidth: 860, margin: "0 auto" }}>
              <div style={{ background: "#0C0F18", border: "1px solid #1A2033", borderRadius: 14, padding: "14px 16px 10px", boxShadow: "0 0 0 1px transparent", transition: "border-color 0.2s, box-shadow 0.2s" }}
                onFocusCapture={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(0,212,232,0.35)"; (e.currentTarget as HTMLDivElement).style.boxShadow = "0 0 0 3px rgba(0,212,232,0.06)"; }}
                onBlurCapture={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = "#1A2033"; (e.currentTarget as HTMLDivElement).style.boxShadow = "0 0 0 1px transparent"; }}
              >
                <textarea
                  ref={textareaRef}
                  className="chat-input"
                  rows={1}
                  placeholder={workspace ? `Ask about ${workspace.folderName}...` : "Open a folder in IDE Editor first, then ask anything..."}
                  value={inputValue}
                  onChange={handleTextareaChange}
                  onKeyDown={handleKeyDown}
                  style={{ height: "auto", minHeight: 28, maxHeight: 160 }}
                />

                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10, flexWrap: "wrap", gap: 8 }}>
                  {/* Action chips — send pre-formed queries */}
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    {[
                      { label: "Analyze", prompt: workspace ? `Analyze the ${workspace.folderName} project structure` : "Analyze project", icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> },
                      { label: "Flowchart", prompt: workspace ? `Generate a flowchart of ${workspace.folderName}` : "Generate a flowchart", icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg> },
                      { label: "Summarize", prompt: workspace ? `Summarize the ${workspace.folderName} codebase` : "Summarize codebase", icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> },
                      { label: "Functions", prompt: workspace ? `List all exported functions in ${workspace.folderName}` : "List all exported functions", icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg> },
                    ].map(({ label, prompt, icon }) => (
                      <button key={label} className="action-btn" onClick={() => handleSend(prompt)}>
                        {icon}{label}
                      </button>
                    ))}
                  </div>

                  {/* Send button */}
                  <button
                    onClick={() => handleSend()}
                    disabled={!inputValue.trim() || isThinking}
                    style={{ width: 36, height: 36, borderRadius: 9, background: inputValue.trim() && !isThinking ? "#00D4E8" : "#1A2033", border: "none", cursor: inputValue.trim() && !isThinking ? "none" : "default", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.2s", flexShrink: 0 }}
                    onMouseEnter={(e) => { if (inputValue.trim() && !isThinking) { e.currentTarget.style.background = "#00FFFF"; e.currentTarget.style.transform = "scale(1.05)"; } }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = inputValue.trim() && !isThinking ? "#00D4E8" : "#1A2033"; e.currentTarget.style.transform = "scale(1)"; }}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={inputValue.trim() && !isThinking ? "#07090E" : "#3A4560"} strokeWidth="2.5">
                      <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
                    </svg>
                  </button>
                </div>
              </div>

              <p style={{ color: "#1A2533", fontSize: "0.7rem", textAlign: "center", marginTop: 8, fontFamily: "'JetBrains Mono', monospace" }}>
                Context: {workspace ? `${workspace.folderName} (${workspace.files.length} files)` : "no workspace"} · Enter to send · Shift+Enter for new line
              </p>
            </div>
          </div>
        </main>
      </div>
    </>
  );
}
