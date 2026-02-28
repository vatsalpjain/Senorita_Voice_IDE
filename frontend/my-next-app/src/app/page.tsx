// import Image from "next/image";

// export default function Home() {
//   return (
//     <div className="flex min-h-screen items-center justify-center bg-zinc-50 font-sans dark:bg-black">
//       <main className="flex min-h-screen w-full max-w-3xl flex-col items-center justify-between py-32 px-16 bg-white dark:bg-black sm:items-start">
//         <Image
//           className="dark:invert"
//           src="/next.svg"
//           alt="Next.js logo"
//           width={100}
//           height={20}
//           priority
//         />
//         <div className="flex flex-col items-center gap-6 text-center sm:items-start sm:text-left">
//           <h1 className="max-w-xs text-3xl font-semibold leading-10 tracking-tight text-black dark:text-zinc-50">
//             To get started, edit the page.tsx file.
//           </h1>
//           <p className="max-w-md text-lg leading-8 text-zinc-600 dark:text-zinc-400">
//             Looking for a starting point or more instructions? Head over to{" "}
//             <a
//               href="https://vercel.com/templates?framework=next.js&utm_source=create-next-app&utm_medium=appdir-template-tw&utm_campaign=create-next-app"
//               className="font-medium text-zinc-950 dark:text-zinc-50"
//             >
//               Templates
//             </a>{" "}
//             or the{" "}
//             <a
//               href="https://nextjs.org/learn?utm_source=create-next-app&utm_medium=appdir-template-tw&utm_campaign=create-next-app"
//               className="font-medium text-zinc-950 dark:text-zinc-50"
//             >
//               Learning
//             </a>{" "}
//             center.
//           </p>
//         </div>
//         <div className="flex flex-col gap-4 text-base font-medium sm:flex-row">
//           <a
//             className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-foreground px-5 text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc] md:w-[158px]"
//             href="https://vercel.com/new?utm_source=create-next-app&utm_medium=appdir-template-tw&utm_campaign=create-next-app"
//             target="_blank"
//             rel="noopener noreferrer"
//           >
//             <Image
//               className="dark:invert"
//               src="/vercel.svg"
//               alt="Vercel logomark"
//               width={16}
//               height={16}
//             />
//             Deploy Now
//           </a>
//           <a
//             className="flex h-12 w-full items-center justify-center rounded-full border border-solid border-black/[.08] px-5 transition-colors hover:border-transparent hover:bg-black/[.04] dark:border-white/[.145] dark:hover:bg-[#1a1a1a] md:w-[158px]"
//             href="https://nextjs.org/docs?utm_source=create-next-app&utm_medium=appdir-template-tw&utm_campaign=create-next-app"
//             target="_blank"
//             rel="noopener noreferrer"
//           >
//             Documentation
//           </a>
//         </div>
//       </main>
//     </div>
//   );
// }





"use client";

import { useState, useEffect, useRef } from "react";

/* ============================================================
   TYPES
   ============================================================ */
interface FeatureItem {
  title: string;
  desc: string;
  icon: string;
  accent: string;
  size: "large" | "normal" | "small";
  tag: string;
}

interface StepItem {
  num: string;
  title: string;
  desc: string;
  icon: React.ReactNode;
}

interface DemoCommand {
  cmd: string;
  response: string;
}

interface StatItem {
  val: string;
  label: string;
}

interface WaveBar {
  delay: string;
  dur: string;
}

/* ============================================================
   GLOBAL STYLES
   ============================================================ */
const GlobalStyles = (): React.ReactElement => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=DM+Sans:ital,wght@0,300;0,400;0,500;1,300&family=JetBrains+Mono:wght@400;500&display=swap');

    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --void: #07090E;
      --surface: #0C0F18;
      --panel: #111520;
      --border: #1A2033;
      --cyan-core: #00D4E8;
      --cyan-bright: #00FFFF;
      --cyan-dim: rgba(0,212,232,0.08);
    }

    html { scroll-behavior: smooth; }

    body {
      background: var(--void);
      color: #C8D5E8;
      font-family: 'DM Sans', sans-serif;
      overflow-x: hidden;
      cursor: none;
    }

    .cursor-dot {
      position: fixed; top: 0; left: 0; z-index: 9999;
      width: 8px; height: 8px;
      background: var(--cyan-bright);
      border-radius: 50%;
      pointer-events: none;
      transition: transform 0.1s ease;
      box-shadow: 0 0 12px var(--cyan-core), 0 0 24px rgba(0,212,232,0.4);
    }
    .cursor-ring {
      position: fixed; top: 0; left: 0; z-index: 9998;
      width: 32px; height: 32px;
      border: 1px solid rgba(0,212,232,0.4);
      border-radius: 50%;
      pointer-events: none;
      transition: transform 0.15s ease, width 0.2s, height 0.2s, opacity 0.2s;
    }

    @keyframes float1 {
      0%,100% { transform: translate(0,0) scale(1); }
      33% { transform: translate(40px,-60px) scale(1.05); }
      66% { transform: translate(-30px,30px) scale(0.97); }
    }
    @keyframes float2 {
      0%,100% { transform: translate(0,0) scale(1); }
      40% { transform: translate(-50px,40px) scale(1.08); }
      70% { transform: translate(60px,-20px) scale(0.95); }
    }
    @keyframes float3 {
      0%,100% { transform: translate(0,0); }
      50% { transform: translate(30px,50px); }
    }
    @keyframes scanLine {
      0% { transform: translateY(-100%); opacity: 0; }
      5% { opacity: 1; }
      95% { opacity: 1; }
      100% { transform: translateY(100vh); opacity: 0; }
    }
    @keyframes shimmer {
      0% { background-position: -200% center; }
      100% { background-position: 200% center; }
    }
    @keyframes pulseGlow {
      0%,100% { box-shadow: 0 0 20px rgba(0,212,232,0.2), 0 0 40px rgba(0,212,232,0.1); }
      50% { box-shadow: 0 0 40px rgba(0,212,232,0.4), 0 0 80px rgba(0,212,232,0.2); }
    }
    @keyframes waveBar {
      0%,100% { transform: scaleY(0.3); }
      50% { transform: scaleY(1); }
    }
    @keyframes blink {
      0%,100% { opacity: 1; }
      50% { opacity: 0; }
    }
    @keyframes fadeUp {
      from { opacity: 0; transform: translateY(30px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    @keyframes slideDown {
      from { opacity: 0; transform: translateY(-16px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes drawLine {
      from { stroke-dashoffset: 200; }
      to { stroke-dashoffset: 0; }
    }
    @keyframes gridPulse {
      0%,100% { opacity: 0.03; }
      50% { opacity: 0.06; }
    }
    @keyframes marquee {
      0% { transform: translateX(0); }
      100% { transform: translateX(-50%); }
    }
    @keyframes successPulse {
      0% { box-shadow: 0 0 0 0 rgba(0,229,160,0.4); }
      70% { box-shadow: 0 0 0 12px rgba(0,229,160,0); }
      100% { box-shadow: 0 0 0 0 rgba(0,229,160,0); }
    }
    @keyframes globeRotate {
      from { transform: rotate(0deg); }
      to   { transform: rotate(360deg); }
    }
    @keyframes globeRotateY {
      from { transform: rotateY(0deg); }
      to   { transform: rotateY(360deg); }
    }
    @keyframes globePulseGlow {
      0%,100% { transform: translate(-50%,-50%) scale(1);   opacity: 0.45; filter: blur(40px); }
      50%      { transform: translate(-50%,-50%) scale(1.15); opacity: 0.75; filter: blur(60px); }
    }

    .animate-fade-up { animation: fadeUp 0.7s ease forwards; }
    .animate-fade-in { animation: fadeIn 0.7s ease forwards; }
    .animate-slide-down { animation: slideDown 0.5s ease forwards; }

    .font-display { font-family: 'Syne', sans-serif; }
    .font-mono { font-family: 'JetBrains Mono', monospace; }

    ::-webkit-scrollbar { width: 4px; }
    ::-webkit-scrollbar-track { background: var(--void); }
    ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }

    .glass {
      background: rgba(13,16,24,0.7);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border: 1px solid #1A2033;
    }

    .gradient-text {
      background: linear-gradient(135deg, #00FFFF 0%, #4DD9E8 40%, #8A9BB8 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }

    .shimmer-text {
      background: linear-gradient(90deg, #8A9BB8 0%, #00FFFF 30%, #4DD9E8 50%, #00FFFF 70%, #8A9BB8 100%);
      background-size: 200% auto;
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      animation: shimmer 3s linear infinite;
    }

    .noise::after {
      content: '';
      position: absolute; inset: 0;
      background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='1'/%3E%3C/svg%3E");
      opacity: 0.025;
      pointer-events: none;
      z-index: 1;
    }

    .grid-bg {
      background-image:
        linear-gradient(rgba(0,212,232,0.04) 1px, transparent 1px),
        linear-gradient(90deg, rgba(0,212,232,0.04) 1px, transparent 1px);
      background-size: 60px 60px;
      animation: gridPulse 4s ease-in-out infinite;
    }

    .card-hover {
      transition: border-color 0.3s ease, box-shadow 0.3s ease, transform 0.3s ease;
    }
    .card-hover:hover {
      border-color: rgba(0,212,232,0.3) !important;
      box-shadow: 0 0 30px rgba(0,212,232,0.08), 0 8px 32px rgba(0,0,0,0.4);
      transform: translateY(-2px);
    }

    .btn-primary {
      position: relative;
      background: var(--cyan-core);
      color: #07090E;
      font-family: 'Syne', sans-serif;
      font-weight: 700;
      font-size: 0.9rem;
      letter-spacing: 0.02em;
      padding: 14px 32px;
      border-radius: 8px;
      border: none;
      cursor: none;
      overflow: hidden;
      transition: transform 0.2s ease, box-shadow 0.2s ease;
      animation: pulseGlow 3s ease-in-out infinite;
    }
    .btn-primary:hover {
      transform: scale(1.04);
      box-shadow: 0 0 40px rgba(0,212,232,0.5), 0 0 80px rgba(0,212,232,0.2);
    }
    .btn-primary::after {
      content: '';
      position: absolute; inset: 0;
      background: linear-gradient(135deg, rgba(255,255,255,0.15) 0%, transparent 100%);
    }

    .btn-secondary {
      background: transparent;
      color: #8A9BB8;
      font-family: 'Syne', sans-serif;
      font-weight: 600;
      font-size: 0.9rem;
      padding: 13px 32px;
      border-radius: 8px;
      border: 1px solid #1A2033;
      cursor: none;
      transition: border-color 0.2s ease, color 0.2s ease;
    }
    .btn-secondary:hover {
      border-color: rgba(0,212,232,0.4);
      color: #00D4E8;
    }
  `}</style>
);

/* ============================================================
   CUSTOM CURSOR
   ============================================================ */
const CustomCursor = (): React.ReactElement => {
  const dotRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const pos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const ringPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  useEffect(() => {
    const move = (e: MouseEvent): void => {
      pos.current = { x: e.clientX, y: e.clientY };
      if (dotRef.current) {
        dotRef.current.style.transform = `translate(${e.clientX - 4}px, ${e.clientY - 4}px)`;
      }
    };

    let raf: number;
    const animateRing = (): void => {
      ringPos.current.x += (pos.current.x - ringPos.current.x) * 0.12;
      ringPos.current.y += (pos.current.y - ringPos.current.y) * 0.12;
      if (ringRef.current) {
        ringRef.current.style.transform = `translate(${ringPos.current.x - 16}px, ${ringPos.current.y - 16}px)`;
      }
      raf = requestAnimationFrame(animateRing);
    };

    window.addEventListener("mousemove", move);
    raf = requestAnimationFrame(animateRing);
    return () => {
      window.removeEventListener("mousemove", move);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <>
      <div ref={dotRef} className="cursor-dot" />
      <div ref={ringRef} className="cursor-ring" />
    </>
  );
};

/* ============================================================
   GRADIENT ORBS
   ============================================================ */
const GradientOrbs = (): React.ReactElement => (
  <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none", zIndex: 0 }}>
    <div style={{
      position: "absolute", top: "-20%", left: "15%",
      width: 700, height: 700,
      background: "radial-gradient(circle, rgba(0,212,232,0.12) 0%, transparent 65%)",
      borderRadius: "50%",
      animation: "float1 12s ease-in-out infinite",
    }} />
    <div style={{
      position: "absolute", top: "10%", right: "-10%",
      width: 500, height: 500,
      background: "radial-gradient(circle, rgba(77,217,232,0.08) 0%, transparent 65%)",
      borderRadius: "50%",
      animation: "float2 15s ease-in-out infinite",
    }} />
    <div style={{
      position: "absolute", bottom: "-10%", left: "40%",
      width: 400, height: 400,
      background: "radial-gradient(circle, rgba(0,229,160,0.06) 0%, transparent 65%)",
      borderRadius: "50%",
      animation: "float3 10s ease-in-out infinite",
    }} />
  </div>
);

/* ============================================================
   SCAN LINE
   ============================================================ */
const ScanLine = (): React.ReactElement => (
  <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none", zIndex: 1 }}>
    <div style={{
      position: "absolute", left: 0, right: 0, height: 2,
      background: "linear-gradient(90deg, transparent 0%, rgba(0,212,232,0.15) 20%, rgba(0,255,255,0.3) 50%, rgba(0,212,232,0.15) 80%, transparent 100%)",
      animation: "scanLine 6s linear infinite",
      animationDelay: "2s",
    }} />
  </div>
);

/* ============================================================
   SENORITA LOGO
   ============================================================ */
const SenoritaLogo = ({ size = 120, dim = false }: { size?: number; dim?: boolean }): React.ReactElement => (
  <img
    src="/logo3.png"
    alt="Señorita"
    style={{
      width: size,
      height: "auto",
      objectFit: "contain",
      flexShrink: 0,
      display: "block",
      mixBlendMode: "screen",
      opacity: dim ? 0.55 : 1,
    }}
  />
);

/* ============================================================
   NAV
   ============================================================ */
const Nav = (): React.ReactElement => {
  const [scrolled, setScrolled] = useState<boolean>(false);

  useEffect(() => {
    const handler = (): void => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handler);
    return () => window.removeEventListener("scroll", handler);
  }, []);

  return (
    <nav
      className="animate-slide-down"
      style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 100,
        padding: "0 40px", height: 100,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        background: scrolled ? "rgba(7,9,14,0.85)" : "transparent",
        backdropFilter: scrolled ? "blur(20px)" : "none",
        borderBottom: scrolled ? "1px solid rgba(26,32,51,0.8)" : "1px solid transparent",
        transition: "all 0.4s ease",
      }}
    >
      {/* Logo */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <SenoritaLogo size={200} />
      </div>

      {/* Links */}
      <div style={{ display: "flex", alignItems: "center", gap: 32 }}>
        {(["Features", "How it works", "Docs"] as const).map((link) => (
          <a
            key={link}
            href="#"
            style={{ color: "#5A6888", fontSize: "0.875rem", fontWeight: 400, textDecoration: "none", transition: "color 0.2s", fontFamily: "'DM Sans', sans-serif" }}
            onMouseEnter={(e: React.MouseEvent<HTMLAnchorElement>) => (e.currentTarget.style.color = "#C8D5E8")}
            onMouseLeave={(e: React.MouseEvent<HTMLAnchorElement>) => (e.currentTarget.style.color = "#5A6888")}
          >
            {link}
          </a>
        ))}
        <a
          href="/copilot"
          style={{ color: "#00D4E8", fontSize: "0.875rem", fontWeight: 500, textDecoration: "none", transition: "color 0.2s", fontFamily: "'DM Sans', sans-serif", display: "flex", alignItems: "center", gap: 5 }}
          onMouseEnter={(e: React.MouseEvent<HTMLAnchorElement>) => (e.currentTarget.style.color = "#00FFFF")}
          onMouseLeave={(e: React.MouseEvent<HTMLAnchorElement>) => (e.currentTarget.style.color = "#00D4E8")}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          Copilot
        </a>
      </div>

      {/* CTA */}
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <span style={{ color: "#3A4560", fontSize: "0.875rem", cursor: "none" }}>Sign in</span>
        <a href="/dashboard" style={{ textDecoration: "none" }}>
          <button style={{ padding: "10px 22px", fontSize: "0.82rem", background: "transparent", border: "1px solid #3A5070", borderRadius: 8, color: "#C8D5E8", cursor: "pointer", fontFamily: "'DM Sans', sans-serif", transition: "all 0.2s" }}
            onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.borderColor = "#00D4E8"; e.currentTarget.style.color = "#00D4E8"; }}
            onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.borderColor = "#3A5070"; e.currentTarget.style.color = "#C8D5E8"; }}
          >
            Dashboard
          </button>
        </a>
        <a href="/editor" style={{ textDecoration: "none" }}>
          <button className="btn-primary" style={{ padding: "10px 22px", fontSize: "0.82rem" }}>
            Open IDE →
          </button>
        </a>
      </div>
    </nav>
  );
};

/* ============================================================
   VOICE WAVEFORM
   ============================================================ */
interface VoiceWaveformProps {
  active?: boolean;
}

const VoiceWaveform = ({ active = true }: VoiceWaveformProps): React.ReactElement => {
  const bars: WaveBar[] = [
    { delay: "0s",     dur: "0.6s"  },
    { delay: "0.1s",   dur: "0.5s"  },
    { delay: "0.05s",  dur: "0.7s"  },
    { delay: "0.15s",  dur: "0.55s" },
    { delay: "0.08s",  dur: "0.65s" },
    { delay: "0.12s",  dur: "0.58s" },
    { delay: "0.03s",  dur: "0.72s" },
  ];

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 3, height: 24 }}>
      {bars.map((bar, i) => (
        <div
          key={i}
          style={{
            width: 3, height: "100%", borderRadius: 2,
            background: active ? "#00D4E8" : "#1A2033",
            transformOrigin: "center",
            animation: active ? `waveBar ${bar.dur} ease-in-out infinite ${bar.delay}` : "none",
            opacity: active ? 1 : 0.3,
            transition: "background 0.3s, opacity 0.3s",
          }}
        />
      ))}
    </div>
  );
};

/* ============================================================
   CODE TYPING ANIMATION
   ============================================================ */
interface CodeLine {
  text: string;
  color: string;
}

const CODE_LINES: CodeLine[] = [
  { text: `// Voice command: "refactor this function"`, color: "#3A4560" },
  { text: `async function processVoiceInput(`,          color: "#00D4E8" },
  { text: `  transcript: string,`,                      color: "#8A9BB8" },
  { text: `  context: EditorContext`,                   color: "#8A9BB8" },
  { text: `): Promise<AIResponse> {`,                   color: "#00D4E8" },
  { text: `  const parsed = await`,                     color: "#C8D5E8" },
  { text: `    CommandParser.parse(transcript);`,        color: "#4DD9E8" },
  { text: `  return llm.generate(parsed, context);`,    color: "#C8D5E8" },
  { text: `}`,                                          color: "#00D4E8" },
];

const CodeTypingAnimation = (): React.ReactElement => {
  const [visibleLines, setVisibleLines] = useState<number>(0);
  const [charCount, setCharCount] = useState<number>(0);
  const [done, setDone] = useState<boolean>(false);

  useEffect(() => {
    if (done) {
      const reset = setTimeout(() => {
        setVisibleLines(0);
        setCharCount(0);
        setDone(false);
      }, 3000);
      return () => clearTimeout(reset);
    }

    if (visibleLines >= CODE_LINES.length) {
      // Avoid calling setState synchronously in effect; defer to next tick
      setTimeout(() => setDone(true), 0);
      return;
    }

    const currentLine = CODE_LINES[visibleLines];
    if (charCount < currentLine.text.length) {
      const t = setTimeout(() => setCharCount((c) => c + 1), 28);
      return () => clearTimeout(t);
    } else {
      const t = setTimeout(() => {
        setVisibleLines((l) => l + 1);
        setCharCount(0);
      }, 60);
      return () => clearTimeout(t);
    }
  }, [visibleLines, charCount, done]);

  return (
    <div
      className="font-mono"
      style={{
        background: "#080B12", borderRadius: 8,
        padding: "16px 20px", fontSize: "0.78rem",
        lineHeight: 1.8, minHeight: 220,
        border: "1px solid #1A2033",
        position: "relative", overflow: "hidden",
      }}
    >
      {/* Line numbers */}
      <div style={{
        position: "absolute", left: 0, top: 0, bottom: 0, width: 36,
        background: "#060810", borderRight: "1px solid #0F1420",
        display: "flex", flexDirection: "column", paddingTop: 16,
      }}>
        {CODE_LINES.map((_, i) => (
          <div
            key={i}
            style={{
              color: i < visibleLines ? "#2A3555" : "transparent",
              fontSize: "0.7rem", textAlign: "right",
              paddingRight: 8, lineHeight: 1.8,
              transition: "color 0.2s",
            }}
          >
            {i + 1}
          </div>
        ))}
      </div>

      <div style={{ marginLeft: 44 }}>
        {CODE_LINES.map((line, i) => {
          if (i > visibleLines) return null;
          const isCurrentLine = i === visibleLines;
          const text = isCurrentLine ? line.text.slice(0, charCount) : line.text;
          return (
            <div key={i} style={{ color: line.color, whiteSpace: "pre" }}>
              {text}
              {isCurrentLine && !done && (
                <span style={{ animation: "blink 1s ease-in-out infinite", color: "#00FFFF" }}>│</span>
              )}
            </div>
          );
        })}
        {done && (
          <div style={{ marginTop: 8, color: "#00E5A0", fontSize: "0.72rem", animation: "successPulse 1s ease-out" }}>
            ✓ Refactored successfully
          </div>
        )}
      </div>
    </div>
  );
};

/* ============================================================
   HERO DEMO BLOCK
   ============================================================ */
const HeroDemoBlock = (): React.ReactElement => {
  const [voiceActive, setVoiceActive] = useState<boolean>(true);

  useEffect(() => {
    const interval = setInterval(() => setVoiceActive((v) => !v), 4500);
    return () => clearInterval(interval);
  }, []);

  return (
    <div style={{
      background: "#0C0F18", borderRadius: 16,
      border: "1px solid #1A2033", overflow: "hidden",
      boxShadow: "0 0 60px rgba(0,212,232,0.08), 0 32px 80px rgba(0,0,0,0.6)",
      position: "relative", maxWidth: 580, width: "100%",
    }}>
      {/* Window chrome */}
      <div style={{
        display: "flex", alignItems: "center", padding: "12px 16px",
        background: "#080B12", borderBottom: "1px solid #1A2033", gap: 8,
      }}>
        <div style={{ display: "flex", gap: 6 }}>
          {(["#FF5F57", "#FEBC2E", "#28C840"] as const).map((c, i) => (
            <div key={i} style={{ width: 10, height: 10, borderRadius: "50%", background: c, opacity: 0.7 }} />
          ))}
        </div>
        <div style={{
          flex: 1, textAlign: "center",
          color: "#2A3555", fontSize: "0.72rem",
          fontFamily: "'JetBrains Mono', monospace",
        }}>
          voice-ide — workspace/main.ts
        </div>
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          background: "rgba(0,212,232,0.1)",
          border: "1px solid rgba(0,212,232,0.2)",
          borderRadius: 20, padding: "4px 12px",
        }}>
          <VoiceWaveform active={voiceActive} />
          <span style={{
            color: voiceActive ? "#00D4E8" : "#3A4560",
            fontSize: "0.72rem", fontFamily: "'DM Sans', sans-serif",
            transition: "color 0.3s",
          }}>
            {voiceActive ? "Listening..." : "Idle"}
          </span>
        </div>
      </div>

      {/* Voice transcript */}
      <div style={{
        padding: "10px 16px",
        background: "rgba(0,212,232,0.04)",
        borderBottom: "1px solid rgba(26,32,51,0.6)",
        display: "flex", alignItems: "center", gap: 10,
      }}>
        <div style={{
          width: 6, height: 6, borderRadius: "50%",
          background: voiceActive ? "#00D4E8" : "#2A3555",
          boxShadow: voiceActive ? "0 0 8px #00D4E8" : "none",
          transition: "all 0.3s",
          animation: voiceActive ? "pulseGlow 1.5s infinite" : "none",
        }} />
        <span className="font-mono" style={{
          color: voiceActive ? "#8A9BB8" : "#2A3555",
          fontSize: "0.75rem", transition: "color 0.3s", fontStyle: "italic",
        }}>
          {voiceActive ? '"refactor this function to be async"' : "...awaiting voice input"}
        </span>
      </div>

      {/* Code editor */}
      <div style={{ padding: 16 }}>
        <CodeTypingAnimation />
      </div>

      {/* Status bar */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "8px 16px", background: "#060810",
        borderTop: "1px solid #0F1420",
        fontSize: "0.68rem", fontFamily: "'JetBrains Mono', monospace",
      }}>
        <div style={{ display: "flex", gap: 16, color: "#2A3555" }}>
          <span style={{ color: "#00D4E8" }}>⬡ TypeScript</span>
          <span>LF · UTF-8</span>
          <span>Ln 1, Col 1</span>
        </div>
        <div style={{ display: "flex", gap: 12, color: "#2A3555" }}>
          <span style={{ color: "#00E5A0" }}>✓ 0 errors</span>
          <span>AI Ready</span>
        </div>
      </div>
    </div>
  );
};

/* ============================================================
   GLOBE HERO
   ============================================================ */
const GlobeHero = (): React.ReactElement => (
  <section style={{
    position: "relative", minHeight: "100vh",
    display: "flex", alignItems: "center", justifyContent: "center",
    overflow: "hidden",
    background: "radial-gradient(ellipse 80% 60% at 50% 40%, rgba(19,91,236,0.18) 0%, rgba(0,212,232,0.08) 40%, transparent 70%), #07090E",
  }}>
    {/* Globe PNG backdrop — outer div centers, inner div rotates */}
    <div style={{
      position: "absolute",
      top: "50%", left: "50%",
      transform: "translate(-50%, -50%)",
      width: "min(110vw, 1100px)",
      height: "min(110vw, 1100px)",
      pointerEvents: "none",
      zIndex: 1,
      maskImage: "radial-gradient(ellipse 48% 48% at 50% 50%, black 35%, transparent 68%)",
      WebkitMaskImage: "radial-gradient(ellipse 48% 48% at 50% 50%, black 35%, transparent 68%)",
    }}>
      <div style={{
        width: "100%", height: "100%",
        animation: "globeRotate 30s linear infinite",
      }}>
        <img
          src="/globe.png"
          alt="Globe"
          style={{
            width: "100%",
            height: "100%",
            objectFit: "contain",
            mixBlendMode: "screen",
            opacity: 0.95,
            display: "block",
          }}
        />
      </div>
    </div>

    {/* Foreground text — centred over the globe */}
    <div style={{
      position: "relative", zIndex: 10,
      maxWidth: 860, width: "100%",
      textAlign: "center",
      display: "flex", flexDirection: "column", alignItems: "center", gap: 24,
      padding: "0 24px",
    }}>
      {/* Badge */}
      <div
        className="animate-fade-up"
        style={{
          display: "inline-flex", alignItems: "center", gap: 8,
          background: "rgba(0,212,232,0.10)",
          border: "1px solid rgba(0,212,232,0.28)",
          borderRadius: 100, padding: "6px 18px",
          animationDelay: "0.1s", opacity: 0, animationFillMode: "forwards",
        }}
      >
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
          <path d="M6.5 1 L8 5h4L9 7.5l1.2 4L6.5 9.2 3.3 11.5 4.5 7.5 1 5h4z" fill="#00D4E8" />
        </svg>
        <span style={{ color: "#4DD9E8", fontSize: "0.72rem", fontFamily: "'DM Sans', sans-serif", fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase" }}>
          Next Generation Infrastructure
        </span>
      </div>

      {/* Headline */}
      <h1
        className="font-display animate-fade-up"
        style={{
          fontSize: "clamp(1.4rem, 3.2vw, 2.8rem)", fontWeight: 800,
          letterSpacing: "-0.03em", lineHeight: 1.2,
          color: "#EEF4FF", margin: 0, whiteSpace: "nowrap",
          animationDelay: "0.22s", opacity: 0, animationFillMode: "forwards",
          textShadow: "0 0 80px rgba(0,212,232,0.18)",
        }}
      >
        Code with your <span style={{
          background: "linear-gradient(90deg, #135bec 0%, #00D4E8 45%, #8b5cf6 100%)",
          WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text",
        }}>voice.</span>
        <br />
        <span className="shimmer-text">Ship at the speed of thought.</span>
      </h1>

      {/* Sub */}
      <p
        className="animate-fade-up"
        style={{
          fontSize: "clamp(1rem, 2vw, 1.2rem)", color: "rgba(200,213,232,0.7)",
          lineHeight: 1.65, maxWidth: 560, margin: 0,
          animationDelay: "0.38s", opacity: 0, animationFillMode: "forwards",
        }}
      >
        A browser-based IDE where your voice commands become code in real time.
        Powered by LLMs, built for the future of development.
      </p>

      {/* CTAs */}
      <div
        className="animate-fade-up"
        style={{
          display: "flex", gap: 16, flexWrap: "wrap", justifyContent: "center",
          animationDelay: "0.52s", opacity: 0, animationFillMode: "forwards",
          marginTop: 8,
        }}
      >
        <button className="btn-primary" style={{ fontSize: "1rem", padding: "15px 36px", borderRadius: 12 }}>
          Launch IDE — Free →
        </button>
        <button className="btn-secondary" style={{
          fontSize: "1rem", padding: "14px 36px", borderRadius: 12,
          display: "flex", alignItems: "center", gap: 8,
        }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.2" />
            <path d="M6.5 5.5 L10.5 8 L6.5 10.5 V5.5Z" fill="currentColor" />
          </svg>
          View Demo
        </button>
      </div>
    </div>
  </section>
);

/* ============================================================
   TERMINAL SECTION  (appears on scroll, after the globe)
   ============================================================ */
const TerminalSection = (): React.ReactElement => (
  <section style={{
    padding: "100px 40px",
    background: "#07090E",
    display: "flex", flexDirection: "column", alignItems: "center", gap: 48,
    borderTop: "1px solid #111824",
  }}>
    {/* Section label */}
    <div style={{ textAlign: "center" }}>
      <span className="font-mono" style={{ color: "#00D4E8", fontSize: "0.78rem", letterSpacing: "0.1em", textTransform: "uppercase" }}>
        live demo
      </span>
      <h2
        className="font-display"
        style={{
          fontSize: "clamp(1.8rem, 3vw, 2.6rem)", fontWeight: 700,
          color: "#EEF4FF", letterSpacing: "-0.03em", marginTop: 12,
        }}
      >
        Watch it work in real time
      </h2>
      <p style={{ color: "#5A6888", marginTop: 12, fontSize: "0.95rem", maxWidth: 480, margin: "12px auto 0" }}>
        Speak a command. See the AI write and refactor your code instantly.
      </p>
    </div>

    {/* The dynamic terminal demo block */}
    <HeroDemoBlock />
  </section>
);

/* ============================================================
   SOCIAL PROOF BAR
   ============================================================ */
const SocialProofBar = (): React.ReactElement => {
  const items: string[] = [
    "Next.js", "TypeScript", "Monaco Editor", "Web Speech API",
    "Tailwind CSS", "FastAPI", "Python", "OpenAI",
    "Next.js", "TypeScript", "Monaco Editor", "Web Speech API",
    "Tailwind CSS", "FastAPI", "Python", "OpenAI",
  ];

  return (
    <div style={{
      borderTop: "1px solid #1A2033", borderBottom: "1px solid #1A2033",
      padding: "16px 0", overflow: "hidden", position: "relative",
    }}>
      <div style={{
        position: "absolute", left: 0, top: 0, bottom: 0, width: 80,
        background: "linear-gradient(90deg, #07090E, transparent)", zIndex: 1,
      }} />
      <div style={{
        position: "absolute", right: 0, top: 0, bottom: 0, width: 80,
        background: "linear-gradient(-90deg, #07090E, transparent)", zIndex: 1,
      }} />
      <div style={{
        display: "flex", gap: 48, alignItems: "center",
        animation: "marquee 20s linear infinite",
        width: "max-content",
      }}>
        {items.map((item, i) => (
          <span
            key={i}
            className="font-mono"
            style={{ color: "#2A3555", fontSize: "0.78rem", whiteSpace: "nowrap", letterSpacing: "0.05em", textTransform: "uppercase" }}
          >
            {item}
          </span>
        ))}
      </div>
    </div>
  );
};

/* ============================================================
   FEATURE BENTO
   ============================================================ */
const FeatureBento = (): React.ReactElement => {
  const features: FeatureItem[] = [
    {
      title: "Natural Voice Commands",
      desc: "Say 'refactor this function', 'add error handling', or 'explain this code'. Your IDE listens and executes in real time.",
      icon: "🎙", accent: "#00D4E8", size: "large", tag: "Core feature",
    },
    {
      title: "Real-time AI Co-pilot",
      desc: "LLM streams code directly into Monaco as you speak. No copy-paste, no context switching.",
      icon: "⚡", accent: "#00E5A0", size: "normal", tag: "AI-powered",
    },
    {
      title: "Multi-language Support",
      desc: "TypeScript, Python, Rust, Go, and 9 more languages with full syntax highlighting.",
      icon: "◈", accent: "#F6C90E", size: "normal", tag: "12 languages",
    },
    {
      title: "Activity Dashboard",
      desc: "GitHub-style commit heatmap of your voice sessions and edits.",
      icon: "▦", accent: "#4DD9E8", size: "small", tag: "Analytics",
    },
    {
      title: "<10ms latency",
      desc: "WebSocket streaming pipeline.",
      icon: "◎", accent: "#FF4D6D", size: "small", tag: "Performance",
    },
  ];

  return (
    <section style={{ padding: "80px 40px", maxWidth: 1200, margin: "0 auto" }}>
      <div style={{ marginBottom: 48, textAlign: "center" }}>
        <span className="font-mono" style={{ color: "#00D4E8", fontSize: "0.78rem", letterSpacing: "0.1em", textTransform: "uppercase" }}>
          capabilities
        </span>
        <h2
          className="font-display"
          style={{
            fontSize: "clamp(2rem, 3vw, 2.8rem)", fontWeight: 700,
            color: "#EEF4FF", letterSpacing: "-0.03em", marginTop: 12,
          }}
        >
          Everything you need.<br />Nothing you don&apos;t.
        </h2>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gridTemplateRows: "auto auto", gap: 16 }}>
        {/* Large card */}
        <div
          className="glass card-hover"
          style={{ gridColumn: "1 / 2", gridRow: "1 / 3", borderRadius: 16, padding: 32, position: "relative", overflow: "hidden", border: "1px solid #1A2033" }}
        >
          <div style={{
            position: "absolute", top: -60, right: -60, width: 200, height: 200,
            background: `radial-gradient(circle, ${features[0].accent}20 0%, transparent 65%)`,
            borderRadius: "50%",
          }} />
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            background: `${features[0].accent}15`,
            border: `1px solid ${features[0].accent}30`,
            borderRadius: 100, padding: "4px 12px", marginBottom: 24,
          }}>
            <span style={{ color: features[0].accent, fontSize: "0.72rem", fontFamily: "'DM Sans', sans-serif" }}>
              {features[0].tag}
            </span>
          </div>
          <div style={{ fontSize: "2.5rem", marginBottom: 16 }}>{features[0].icon}</div>
          <h3 className="font-display" style={{ fontSize: "1.5rem", fontWeight: 700, color: "#EEF4FF", letterSpacing: "-0.02em", marginBottom: 12 }}>
            {features[0].title}
          </h3>
          <p style={{ color: "#5A6888", lineHeight: 1.65, fontSize: "0.9rem" }}>{features[0].desc}</p>
          <div style={{ marginTop: 32, display: "flex", alignItems: "center", gap: 8 }}>
            <VoiceWaveform active={true} />
            <span className="font-mono" style={{ color: "#2A3555", fontSize: "0.7rem" }}>actively listening</span>
          </div>
        </div>

        {/* Normal cards */}
        {features.slice(1, 3).map((f, i) => (
          <div
            key={i}
            className="glass card-hover"
            style={{ borderRadius: 16, padding: 24, border: "1px solid #1A2033", position: "relative", overflow: "hidden" }}
          >
            <div style={{
              position: "absolute", top: -40, right: -40, width: 120, height: 120,
              background: `radial-gradient(circle, ${f.accent}15 0%, transparent 70%)`,
              borderRadius: "50%",
            }} />
            <div style={{
              display: "inline-flex", marginBottom: 16,
              background: `${f.accent}12`, border: `1px solid ${f.accent}25`,
              borderRadius: 100, padding: "3px 10px",
            }}>
              <span style={{ color: f.accent, fontSize: "0.7rem" }}>{f.tag}</span>
            </div>
            <div style={{ fontSize: "1.8rem", marginBottom: 12 }}>{f.icon}</div>
            <h3 className="font-display" style={{ fontSize: "1.1rem", fontWeight: 700, color: "#EEF4FF", marginBottom: 8, letterSpacing: "-0.02em" }}>
              {f.title}
            </h3>
            <p style={{ color: "#5A6888", fontSize: "0.85rem", lineHeight: 1.6 }}>{f.desc}</p>
          </div>
        ))}

        {/* Small cards */}
        {features.slice(3).map((f, i) => (
          <div
            key={i}
            className="glass card-hover"
            style={{ borderRadius: 16, padding: 24, border: "1px solid #1A2033", position: "relative", overflow: "hidden", display: "flex", alignItems: "flex-start", gap: 16 }}
          >
            <div style={{
              width: 44, height: 44, borderRadius: 10, flexShrink: 0,
              background: `${f.accent}15`, border: `1px solid ${f.accent}25`,
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.3rem",
            }}>
              {f.icon}
            </div>
            <div>
              <h3 className="font-display" style={{ fontSize: "1rem", fontWeight: 700, color: "#EEF4FF", marginBottom: 4, letterSpacing: "-0.01em" }}>
                {f.title}
              </h3>
              <p style={{ color: "#5A6888", fontSize: "0.82rem", lineHeight: 1.5 }}>{f.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};

/* ============================================================
   HOW IT WORKS
   ============================================================ */
const HowItWorks = (): React.ReactElement => {
  const steps: StepItem[] = [
    {
      num: "01", title: "Speak your intent",
      desc: "Press space or say 'hey IDE'. Describe what you want to build, refactor, or fix in plain English.",
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3M8 22h8" />
        </svg>
      ),
    },
    {
      num: "02", title: "AI processes & streams",
      desc: "Your command is parsed and sent to the LLM via WebSocket. Code streams directly into your editor in real time.",
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
        </svg>
      ),
    },
    {
      num: "03", title: "Review & iterate",
      desc: "Accept, reject, or refine. Your full session is logged to the dashboard for later review.",
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M20 6L9 17l-5-5" />
        </svg>
      ),
    },
  ];

  return (
    <section style={{ padding: "80px 40px", background: "#0C0F18", borderTop: "1px solid #1A2033", borderBottom: "1px solid #1A2033" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 64 }}>
          <span className="font-mono" style={{ color: "#00D4E8", fontSize: "0.78rem", letterSpacing: "0.1em", textTransform: "uppercase" }}>
            workflow
          </span>
          <h2
            className="font-display"
            style={{ fontSize: "clamp(2rem, 3vw, 2.8rem)", fontWeight: 700, color: "#EEF4FF", letterSpacing: "-0.03em", marginTop: 12 }}
          >
            How it works
          </h2>
        </div>

        <div style={{ display: "flex", gap: 0, alignItems: "flex-start", position: "relative" }}>
          <svg style={{ position: "absolute", top: 32, left: "16.5%", width: "67%", height: 2, overflow: "visible" }}>
            <line x1="0" y1="1" x2="100%" y2="1" stroke="#1A2033" strokeWidth="1" strokeDasharray="4 4" />
            <line x1="0" y1="1" x2="100%" y2="1" stroke="#00D4E8" strokeWidth="1" strokeDasharray="4 4"
              style={{ animation: "drawLine 2s ease 0.5s forwards", strokeDashoffset: 200 }} />
          </svg>

          {steps.map((step, i) => (
            <div key={i} style={{ flex: 1, textAlign: "center", padding: "0 24px" }}>
              <div
                style={{
                  width: 64, height: 64, borderRadius: "50%",
                  background: "#111520", border: "1px solid #1A2033",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  margin: "0 auto 24px", color: "#00D4E8",
                  position: "relative", zIndex: 1,
                  boxShadow: "0 0 0 8px #07090E",
                  transition: "border-color 0.3s, box-shadow 0.3s",
                }}
                onMouseEnter={(e: React.MouseEvent<HTMLDivElement>) => {
                  e.currentTarget.style.borderColor = "#00D4E8";
                  e.currentTarget.style.boxShadow = "0 0 0 8px #07090E, 0 0 24px rgba(0,212,232,0.3)";
                }}
                onMouseLeave={(e: React.MouseEvent<HTMLDivElement>) => {
                  e.currentTarget.style.borderColor = "#1A2033";
                  e.currentTarget.style.boxShadow = "0 0 0 8px #07090E";
                }}
              >
                {step.icon}
              </div>
              <div className="font-mono" style={{ color: "#2A3555", fontSize: "0.7rem", letterSpacing: "0.08em", marginBottom: 8 }}>
                {step.num}
              </div>
              <h3 className="font-display" style={{ fontSize: "1.1rem", fontWeight: 700, color: "#EEF4FF", marginBottom: 12, letterSpacing: "-0.02em" }}>
                {step.title}
              </h3>
              <p style={{ color: "#5A6888", fontSize: "0.88rem", lineHeight: 1.65 }}>{step.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

/* ============================================================
   DEMO STRIP
   ============================================================ */
const DEMO_COMMANDS: DemoCommand[] = [
  { cmd: "create a REST endpoint for user auth",       response: "→ Generating /api/auth/login.ts..." },
  { cmd: "add TypeScript types to this function",      response: "→ Inferring types from usage..."    },
  { cmd: "write unit tests for handleVoiceInput",      response: "→ Creating test suite with Jest..."  },
  { cmd: "explain what this regex does",               response: "→ Analyzing pattern /^[a-zA-Z0-9._%+-]+@..."   },
];

const DemoStrip = (): React.ReactElement => {
  const [activeIdx, setActiveIdx] = useState<number>(0);

  useEffect(() => {
    const interval = setInterval(() => setActiveIdx((i) => (i + 1) % DEMO_COMMANDS.length), 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <section style={{ padding: "80px 40px", maxWidth: 1200, margin: "0 auto" }}>
      <div style={{
        background: "#080B12", borderRadius: 20,
        border: "1px solid #1A2033", overflow: "hidden",
        boxShadow: "0 32px 80px rgba(0,0,0,0.5)",
      }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "14px 20px", background: "#060810", borderBottom: "1px solid #0F1420" }}>
          {(["#FF5F57", "#FEBC2E", "#28C840"] as const).map((c, i) => (
            <div key={i} style={{ width: 10, height: 10, borderRadius: "50%", background: c, opacity: 0.6 }} />
          ))}
          <div style={{ marginLeft: 12, color: "#2A3555", fontSize: "0.75rem", fontFamily: "'JetBrains Mono', monospace" }}>
            voice-ide ── bash
          </div>
        </div>

        <div style={{ padding: "24px 28px", minHeight: 160 }}>
          {DEMO_COMMANDS.slice(0, activeIdx).map((item, i) => (
            <div key={i} style={{ marginBottom: 8 }}>
              <div className="font-mono" style={{ color: "#2A3555", fontSize: "0.82rem" }}>
                <span style={{ color: "#1A2533" }}>❯ </span>
                <span style={{ color: "#3A4560" }}>{item.cmd}</span>
              </div>
              <div className="font-mono" style={{ color: "#2A3555", fontSize: "0.78rem", marginLeft: 16 }}>
                {item.response} <span style={{ color: "#00E5A040" }}>✓ done</span>
              </div>
            </div>
          ))}

          <div>
            <div className="font-mono" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.88rem" }}>
              <span style={{ color: "#00D4E8" }}>❯ </span>
              <VoiceWaveform active={true} />
              <span style={{ color: "#C8D5E8" }}>{DEMO_COMMANDS[activeIdx].cmd}</span>
            </div>
            <div className="font-mono" style={{ color: "#4DD9E8", fontSize: "0.82rem", marginLeft: 24, marginTop: 4 }}>
              {DEMO_COMMANDS[activeIdx].response}
              <span style={{ animation: "blink 1s ease infinite" }}>█</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

/* ============================================================
   CTA FINALE
   ============================================================ */
const CTAFinale = (): React.ReactElement => (
  <section style={{ padding: "100px 40px", textAlign: "center", position: "relative", overflow: "hidden", borderTop: "1px solid #1A2033" }}>
    <div style={{
      position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
      width: 600, height: 400,
      background: "radial-gradient(ellipse, rgba(0,212,232,0.08) 0%, transparent 65%)",
      pointerEvents: "none",
    }} />
    <div style={{ position: "relative", zIndex: 1 }}>
      <span className="font-mono" style={{ color: "#00D4E8", fontSize: "0.78rem", letterSpacing: "0.1em", textTransform: "uppercase" }}>
        get started
      </span>
      <h2
        className="font-display"
        style={{
          fontSize: "clamp(2.5rem, 5vw, 4rem)", fontWeight: 800,
          letterSpacing: "-0.04em", marginTop: 16, marginBottom: 20, color: "#EEF4FF",
        }}
      >
        Your IDE.<br />
        <span className="gradient-text">Your voice.</span>
      </h2>
      <p style={{ color: "#5A6888", fontSize: "1rem", maxWidth: 440, margin: "0 auto 40px", lineHeight: 1.65 }}>
  Join developers who&apos;ve already shipped 10× faster using voice-driven AI coding.
      </p>
      <div style={{ display: "flex", gap: 16, justifyContent: "center" }}>
        <button className="btn-primary" style={{ fontSize: "1rem", padding: "16px 40px" }}>
          Start coding for free →
        </button>
        <button className="btn-secondary" style={{ fontSize: "1rem" }}>
          View on GitHub
        </button>
      </div>
      <p style={{ color: "#2A3555", fontSize: "0.78rem", marginTop: 20 }}>
        No signup required · Open source · Built with ♥ at hackathon
      </p>
    </div>
  </section>
);

/* ============================================================
   FOOTER
   ============================================================ */
const Footer = (): React.ReactElement => (
  <footer style={{ padding: "32px 40px", borderTop: "1px solid #0F1420", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <SenoritaLogo size={60} dim />
    </div>
    <span style={{ color: "#1A2533", fontSize: "0.75rem", fontFamily: "'JetBrains Mono', monospace" }}>
      built at hackathon 2025
    </span>
    <div style={{ display: "flex", gap: 20 }}>
      {(["GitHub", "Docs", "Twitter"] as const).map((l) => (
        <a
          key={l} href="#"
          style={{ color: "#2A3555", fontSize: "0.8rem", textDecoration: "none", transition: "color 0.2s" }}
          onMouseEnter={(e: React.MouseEvent<HTMLAnchorElement>) => (e.currentTarget.style.color = "#5A6888")}
          onMouseLeave={(e: React.MouseEvent<HTMLAnchorElement>) => (e.currentTarget.style.color = "#2A3555")}
        >
          {l}
        </a>
      ))}
    </div>
  </footer>
);

/* ============================================================
   ROOT
   ============================================================ */
export default function LandingPage(): React.ReactElement {
  return (
    <>
      <GlobalStyles />
      <CustomCursor />
      <div style={{ background: "#07090E", minHeight: "100vh" }}>
        <Nav />
        <GlobeHero />
        <TerminalSection />
        <SocialProofBar />
        <FeatureBento />
        <HowItWorks />
        <DemoStrip />
        <CTAFinale />
        <Footer />
      </div>
    </>
  );
}