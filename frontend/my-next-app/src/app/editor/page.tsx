"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import dynamic from "next/dynamic";
import { VoicePanel } from "../../components/VoicePanel";
import {
  AICommandResponse,
  EditorContext,
} from "../../services/aiService";
import type { CodeAction } from "../../components/MonacoEditor";
import {
  openFolderPicker,
  readDirectory,
  readFileContent,
} from "../../services/fileSystemService";

// Dynamic import Monaco to avoid SSR issues
const MonacoEditor = dynamic(() => import("../../components/MonacoEditor"), {
  ssr: false,
  loading: () => (
    <div style={{
      flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
      background: "#0C0F18", color: "#2A3555", fontSize: "0.8rem",
      fontFamily: "'JetBrains Mono', monospace",
    }}>
      Loading Monaco Editor...
    </div>
  ),
});

/* ============================================================
   TYPES
   ============================================================ */
interface FileNode {
  id: string;
  name: string;
  type: "file" | "folder";
  language?: string;
  content?: string;
  children?: FileNode[];
  isOpen?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handle?: any;
}

interface Tab {
  id: string;
  name: string;
  language: string;
  content: string;
  isDirty: boolean;
}

interface BootPhase {
  label: string;
  duration: number;
}

/* ============================================================
   VIRTUAL FILE SYSTEM
   ============================================================ */
const VIRTUAL_FS: FileNode[] = [
  {
    id: "src", name: "src", type: "folder", isOpen: true,
    children: [
      {
        id: "app", name: "app", type: "folder", isOpen: true,
        children: [
          { id: "page", name: "page.tsx", type: "file", language: "typescript", content: `"use client";

import { useState } from "react";

export default function HomePage() {
  const [count, setCount] = useState(0);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center">
      <h1 className="text-4xl font-bold text-white mb-8">
        Voice IDE — Next.js
      </h1>
      <p className="text-zinc-400 mb-4">
        Build faster with your voice.
      </p>
      <button
        onClick={() => setCount(c => c + 1)}
        className="px-6 py-3 bg-cyan-500 text-black rounded-lg font-semibold"
      >
        Clicked {count} times
      </button>
    </main>
  );
}` },
          { id: "layout", name: "layout.tsx", type: "file", language: "typescript", content: `import type { Metadata } from "next";
import { Syne } from "next/font/google";
import "./globals.css";

const syne = Syne({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Voice IDE",
  description: "Code with your voice",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={syne.className}>
        {children}
      </body>
    </html>
  );
}` },
          { id: "globals", name: "globals.css", type: "file", language: "css", content: `@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --background: #07090E;
  --foreground: #EEF4FF;
  --cyan-core: #00D4E8;
}

body {
  background: var(--background);
  color: var(--foreground);
  font-family: 'DM Sans', sans-serif;
}` },
        ],
      },
      {
        id: "components", name: "components", type: "folder", isOpen: false,
        children: [
          { id: "hero", name: "Hero.tsx", type: "file", language: "typescript", content: `import React from "react";

interface HeroProps {
  title: string;
  subtitle: string;
}

export const Hero = ({ title, subtitle }: HeroProps) => {
  return (
    <section className="relative min-h-screen flex items-center">
      <div className="max-w-6xl mx-auto px-10">
        <h1 className="text-6xl font-bold text-white">
          {title}
        </h1>
        <p className="text-xl text-zinc-400 mt-4">
          {subtitle}
        </p>
      </div>
    </section>
  );
};` },
          { id: "navbar", name: "Navbar.tsx", type: "file", language: "typescript", content: `"use client";

export const Navbar = () => {
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 h-16 flex items-center px-10 border-b border-zinc-800">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-cyan-500" />
        <span className="font-bold text-white">VoiceIDE</span>
      </div>
    </nav>
  );
};` },
        ],
      },
      {
        id: "lib", name: "lib", type: "folder", isOpen: false,
        children: [
          { id: "ws", name: "WSClient.ts", type: "file", language: "typescript", content: `type MessageHandler = (data: unknown) => void;

class WSClient {
  private socket: WebSocket | null = null;
  private handlers: Map<string, MessageHandler> = new Map();

  connect(url: string): void {
    this.socket = new WebSocket(url);
    this.socket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      const handler = this.handlers.get(data.type);
      if (handler) handler(data.payload);
    };
  }

  on(type: string, handler: MessageHandler): void {
    this.handlers.set(type, handler);
  }

  send(type: string, payload: unknown): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type, payload }));
    }
  }

  disconnect(): void {
    this.socket?.close();
    this.socket = null;
  }
}

export const wsClient = new WSClient();` },
          { id: "voice", name: "VoiceController.ts", type: "file", language: "typescript", content: `export class VoiceController {
  private recognition: SpeechRecognition | null = null;
  private isListening = false;

  init(): void {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) throw new Error("Speech Recognition not supported");
    this.recognition = new SR();
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = "en-US";
  }

  start(onTranscript: (text: string, final: boolean) => void): void {
    if (!this.recognition) this.init();
    this.recognition!.onresult = (event) => {
      const result = event.results[event.results.length - 1];
      onTranscript(result[0].transcript, result.isFinal);
    };
    this.recognition!.start();
    this.isListening = true;
  }

  stop(): void {
    this.recognition?.stop();
    this.isListening = false;
  }

  get active(): boolean {
    return this.isListening;
  }
}` },
        ],
      },
    ],
  },
  {
    id: "config-files", name: "config", type: "folder", isOpen: false,
    children: [
      { id: "tailwind", name: "tailwind.config.ts", type: "file", language: "typescript", content: `import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        void: "#07090E",
        surface: "#0C0F18",
        panel: "#111520",
        border: "#1A2033",
        cyan: {
          core: "#00D4E8",
          bright: "#00FFFF",
          soft: "#4DD9E8",
        },
      },
      fontFamily: {
        display: ["Syne", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;` },
    ],
  },
  { id: "readme", name: "README.md", type: "file", language: "markdown", content: `# Voice IDE

A browser-based, voice-controlled IDE powered by LLMs.

## Features

- 🎙 **Voice Commands** — Speak to write, refactor, and explain code
- ⚡ **Real-time AI** — LLM streams directly into Monaco Editor
- 🌐 **Web-based** — No installation, runs in any modern browser
- 📊 **Dashboard** — GitHub-style activity tracking

## Getting Started

\`\`\`bash
npm install
npm run dev
\`\`\`

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Tech Stack

- **Frontend**: Next.js 14, TypeScript, Tailwind CSS
- **Editor**: Monaco Editor
- **Voice**: Web Speech API
- **Backend**: Python + FastAPI
- **AI**: OpenAI / Custom LLM
` },
  { id: "env", name: ".env.local", type: "file", language: "plaintext", content: `# Backend
NEXT_PUBLIC_WS_URL=ws://localhost:8000/ws
NEXT_PUBLIC_API_URL=http://localhost:8000

# AI
OPENAI_API_KEY=your_key_here

# App
NEXT_PUBLIC_APP_NAME=VoiceIDE` },
  { id: "pkg", name: "package.json", type: "file", language: "json", content: `{
  "name": "voice-ide",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint"
  },
  "dependencies": {
    "next": "14.2.0",
    "react": "^18",
    "react-dom": "^18",
    "@monaco-editor/react": "^4.6.0",
    "zustand": "^4.5.0",
    "clsx": "^2.1.0"
  },
  "devDependencies": {
    "typescript": "^5",
    "@types/node": "^20",
    "@types/react": "^18",
    "@types/react-dom": "^18",
    "tailwindcss": "^3.4.0",
    "autoprefixer": "^10.0.1",
    "postcss": "^8"
  }
}` },
];

/* ============================================================
   LANGUAGE CONFIG
   ============================================================ */
const LANG_COLORS: Record<string, string> = {
  typescript: "#3178C6",
  javascript: "#F7DF1E",
  css: "#264DE4",
  markdown: "#083FA1",
  json: "#8BC34A",
  plaintext: "#888",
  python: "#3572A5",
};

const LANG_ICONS: Record<string, string> = {
  typescript: "TS",
  javascript: "JS",
  css: "{}",
  markdown: "MD",
  json: "{}",
  plaintext: "TXT",
  python: "PY",
};

const FILE_ICONS: Record<string, string> = {
  ".tsx": "⬡",
  ".ts": "⬡",
  ".jsx": "⬡",
  ".js": "◆",
  ".css": "◈",
  ".md": "◉",
  ".json": "❴❵",
  ".env": "⊛",
  ".local": "⊛",
};

function getFileIcon(name: string): string {
  const ext = name.includes(".env")
    ? ".env"
    : name.substring(name.lastIndexOf("."));
  return FILE_ICONS[ext] || "◦";
}

function getLanguage(name: string): string {
  if (name.endsWith(".tsx") || name.endsWith(".ts")) return "typescript";
  if (name.endsWith(".jsx") || name.endsWith(".js")) return "javascript";
  if (name.endsWith(".css")) return "css";
  if (name.endsWith(".md")) return "markdown";
  if (name.endsWith(".json")) return "json";
  if (name.endsWith(".py")) return "python";
  return "plaintext";
}

/* ============================================================
   SYNTAX HIGHLIGHTER (lightweight, no deps)
   ============================================================ */
function highlightCode(code: string, language: string): React.ReactElement[] {
  const lines = code.split("\n");

  const tokenize = (line: string, lang: string): React.ReactElement => {
    if (lang === "markdown") {
      if (line.startsWith("# ")) return <span style={{ color: "#00D4E8", fontWeight: 700 }}>{line}</span>;
      if (line.startsWith("## ")) return <span style={{ color: "#4DD9E8", fontWeight: 600 }}>{line}</span>;
      if (line.startsWith("- ")) return <span><span style={{ color: "#00E5A0" }}>-</span><span style={{ color: "#C8D5E8" }}>{line.slice(1)}</span></span>;
      if (line.startsWith("```")) return <span style={{ color: "#3A4560" }}>{line}</span>;
      if (line.startsWith("`") && line.endsWith("`")) return <span style={{ color: "#F6C90E" }}>{line}</span>;
      return <span style={{ color: "#8A9BB8" }}>{line}</span>;
    }

    if (lang === "json") {
      const keyMatch = line.match(/^(\s*)"([^"]+)"(\s*:)/);
      if (keyMatch) {
        return (
          <span>
            <span style={{ color: "#C8D5E8" }}>{keyMatch[1]}</span>
            <span style={{ color: "#4DD9E8" }}>&quot;{keyMatch[2]}&quot;</span>
            <span style={{ color: "#C8D5E8" }}>{keyMatch[3]}</span>
            <span style={{ color: "#8A9BB8" }}>{line.slice(keyMatch[0].length)}</span>
          </span>
        );
      }
      return <span style={{ color: "#8A9BB8" }}>{line}</span>;
    }

    // TypeScript/JS/CSS highlighting
  const result = line;
  // Removed unused variable 'parts'

    // Comments
    if (line.trim().startsWith("//") || line.trim().startsWith("#")) {
      return <span style={{ color: "#3A4560", fontStyle: "italic" }}>{line}</span>;
    }

    // Simple token pass
    const keywords = ["import", "export", "from", "const", "let", "var", "function", "return", "async", "await", "interface", "type", "class", "extends", "implements", "default", "if", "else", "for", "while", "new", "this", "null", "undefined", "true", "false", "void", "string", "number", "boolean"];
    const keywordRegex = new RegExp(`\\b(${keywords.join("|")})\\b`, "g");

    let lastIndex = 0;
    let match: RegExpExecArray | null;
    const segments: React.ReactElement[] = [];

    while ((match = keywordRegex.exec(result)) !== null) {
      if (match.index > lastIndex) {
        segments.push(<span key={lastIndex} style={{ color: "#C8D5E8" }}>{result.slice(lastIndex, match.index)}</span>);
      }
      segments.push(<span key={match.index} style={{ color: "#00D4E8" }}>{match[0]}</span>);
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < result.length) {
      segments.push(<span key={lastIndex} style={{ color: "#C8D5E8" }}>{result.slice(lastIndex)}</span>);
    }

    return <span>{segments}</span>;
  };

  return lines.map((line, i) => (
    <div key={i} style={{ display: "flex", minHeight: "1.6em" }}>
      <span style={{ color: "#2A3555", width: 40, textAlign: "right", paddingRight: 16, userSelect: "none", flexShrink: 0, fontSize: "0.75rem" }}>
        {i + 1}
      </span>
      <span style={{ flex: 1 }}>{tokenize(line, language)}</span>
    </div>
  ));
}

/* ============================================================
   BOOT ANIMATION
   ============================================================ */
const BOOT_PHASES: BootPhase[] = [
  { label: "Initializing workspace...",        duration: 500  },
  { label: "Loading virtual file system...",   duration: 700  },
  { label: "Starting Monaco Engine...",        duration: 600  },
  { label: "Connecting AI pipeline...",        duration: 500  },
  { label: "Calibrating voice interface...",   duration: 400  },
  { label: "Ready.",                           duration: 300  },
];

interface BootScreenProps {
  onComplete: () => void;
}

const BootScreen = ({ onComplete }: BootScreenProps): React.ReactElement => {
  const [phase, setPhase] = useState<number>(0);
  const [progress, setProgress] = useState<number>(0);
  const [expanding, setExpanding] = useState<boolean>(false);
  const [done, setDone] = useState<boolean>(false);

  useEffect(() => {
    let elapsed = 0;
    const total = BOOT_PHASES.reduce((a, b) => a + b.duration, 0);

    const runPhases = async (): Promise<void> => {
      for (let i = 0; i < BOOT_PHASES.length; i++) {
        setPhase(i);
        await new Promise<void>((res) => {
          const step = BOOT_PHASES[i].duration / 30;
          let tick = 0;
          const interval = setInterval(() => {
            tick++;
            elapsed += step;
            setProgress(Math.min((elapsed / total) * 100, 100));
            if (tick >= 30) { clearInterval(interval); res(); }
          }, step);
        });
      }
      // Expand animation
      setExpanding(true);
      await new Promise<void>((res) => setTimeout(res, 800));
      setDone(true);
      await new Promise<void>((res) => setTimeout(res, 200));
      onComplete();
    };

    runPhases();
  }, [onComplete]);

  if (done) return <></>;

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 1000,
      background: "#07090E",
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      transition: expanding ? "opacity 0.4s ease, transform 0.8s cubic-bezier(0.4,0,0.2,1)" : "none",
      opacity: expanding ? 0 : 1,
      transform: expanding ? "scale(1.08)" : "scale(1)",
      pointerEvents: expanding ? "none" : "all",
    }}>
      {/* Background grid */}
      <div style={{
        position: "absolute", inset: 0,
        backgroundImage: `
          linear-gradient(rgba(0,212,232,0.03) 1px, transparent 1px),
          linear-gradient(90deg, rgba(0,212,232,0.03) 1px, transparent 1px)
        `,
        backgroundSize: "40px 40px",
      }} />

      {/* Central orb */}
      <div style={{
        position: "relative", marginBottom: 48,
        animation: "bootPulse 2s ease-in-out infinite",
      }}>
        <div style={{
          width: 80, height: 80, borderRadius: "50%",
          background: "linear-gradient(135deg, #00D4E8, #00E5A0)",
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: "0 0 60px rgba(0,212,232,0.4), 0 0 120px rgba(0,212,232,0.2)",
          animation: "spin 3s linear infinite",
        }}>
          <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
            <path d="M6 20 L20 6 L34 20 L20 34 Z" stroke="#07090E" strokeWidth="2.5" fill="none" />
            <circle cx="20" cy="20" r="5" fill="#07090E" />
          </svg>
        </div>
        {/* Rings */}
        {[1, 2, 3].map((ring) => (
          <div key={ring} style={{
            position: "absolute",
            top: "50%", left: "50%",
            transform: "translate(-50%, -50%)",
            width: 80 + ring * 40,
            height: 80 + ring * 40,
            borderRadius: "50%",
            border: `1px solid rgba(0,212,232,${0.15 / ring})`,
            animation: `ringPulse ${1.5 + ring * 0.5}s ease-in-out infinite ${ring * 0.2}s`,
          }} />
        ))}
      </div>

      {/* Logo text */}
      <div style={{
        fontFamily: "'Syne', sans-serif",
        fontSize: "1.5rem", fontWeight: 800,
        color: "#EEF4FF", letterSpacing: "-0.03em",
        marginBottom: 8,
      }}>
        VoiceIDE
      </div>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "0.72rem", color: "#2A3555", marginBottom: 48, letterSpacing: "0.08em" }}>
        v0.1.0 — hackathon edition
      </div>

      {/* Boot log */}
      <div style={{ width: 400, marginBottom: 32 }}>
        {BOOT_PHASES.map((p, i) => (
          <div key={i} style={{
            display: "flex", alignItems: "center", gap: 10,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: "0.72rem", marginBottom: 6,
            opacity: i <= phase ? 1 : 0.2,
            transition: "opacity 0.3s ease",
          }}>
            <span style={{ color: i < phase ? "#00E5A0" : i === phase ? "#00D4E8" : "#2A3555" }}>
              {i < phase ? "✓" : i === phase ? "›" : "·"}
            </span>
            <span style={{ color: i < phase ? "#3A4560" : i === phase ? "#8A9BB8" : "#2A3555" }}>
              {p.label}
            </span>
          </div>
        ))}
      </div>

      {/* Progress bar */}
      <div style={{ width: 400 }}>
        <div style={{
          width: "100%", height: 2,
          background: "#1A2033", borderRadius: 1, overflow: "hidden",
        }}>
          <div style={{
            height: "100%", borderRadius: 1,
            background: "linear-gradient(90deg, #00D4E8, #00E5A0)",
            width: `${progress}%`,
            transition: "width 0.05s linear",
            boxShadow: "0 0 8px rgba(0,212,232,0.6)",
          }} />
        </div>
        <div style={{
          display: "flex", justifyContent: "space-between",
          marginTop: 8,
          fontFamily: "'JetBrains Mono', monospace", fontSize: "0.65rem", color: "#2A3555",
        }}>
          <span>Loading workspace</span>
          <span>{Math.round(progress)}%</span>
        </div>
      </div>

      <style>{`
        @keyframes bootPulse {
          0%,100% { transform: scale(1); }
          50% { transform: scale(1.05); }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes ringPulse {
          0%,100% { transform: translate(-50%,-50%) scale(1); opacity: 0.6; }
          50% { transform: translate(-50%,-50%) scale(1.1); opacity: 0.2; }
        }
      `}</style>
    </div>
  );
};

/* ============================================================
   SIDEBAR — FILE TREE
   ============================================================ */
interface FileTreeNodeProps {
  node: FileNode;
  depth: number;
  onFileClick: (node: FileNode) => void;
  activeFileId: string;
}

const FileTreeNode = ({ node, depth, onFileClick, activeFileId }: FileTreeNodeProps): React.ReactElement => {
  const [open, setOpen] = useState<boolean>(node.isOpen ?? false);

  if (node.type === "folder") {
    return (
      <div>
        <div
          onClick={() => setOpen((o) => !o)}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: `4px 8px 4px ${8 + depth * 14}px`,
            cursor: "pointer", userSelect: "none",
            color: "#5A6888", fontSize: "0.8rem",
            fontFamily: "'DM Sans', sans-serif",
            transition: "color 0.15s",
            borderRadius: 4,
          }}
          onMouseEnter={(e: React.MouseEvent<HTMLDivElement>) => (e.currentTarget.style.color = "#C8D5E8")}
          onMouseLeave={(e: React.MouseEvent<HTMLDivElement>) => (e.currentTarget.style.color = "#5A6888")}
        >
          <span style={{ fontSize: "0.6rem", transition: "transform 0.15s", display: "inline-block", transform: open ? "rotate(90deg)" : "rotate(0deg)" }}>▶</span>
          <span style={{ fontSize: "0.85rem" }}>{open ? "📂" : "📁"}</span>
          <span>{node.name}</span>
        </div>
        {open && node.children?.map((child) => (
          <FileTreeNode key={child.id} node={child} depth={depth + 1} onFileClick={onFileClick} activeFileId={activeFileId} />
        ))}
      </div>
    );
  }

  const isActive = node.id === activeFileId;
  return (
    <div
      onClick={() => onFileClick(node)}
      style={{
        display: "flex", alignItems: "center", gap: 6,
        padding: `4px 8px 4px ${8 + depth * 14}px`,
        cursor: "pointer", userSelect: "none",
        background: isActive ? "rgba(0,212,232,0.08)" : "transparent",
        borderLeft: isActive ? "2px solid #00D4E8" : "2px solid transparent",
        fontSize: "0.8rem",
        fontFamily: "'DM Sans', sans-serif",
        color: isActive ? "#C8D5E8" : "#5A6888",
        transition: "all 0.15s",
        borderRadius: "0 4px 4px 0",
      }}
      onMouseEnter={(e: React.MouseEvent<HTMLDivElement>) => {
        if (!isActive) e.currentTarget.style.color = "#C8D5E8";
      }}
      onMouseLeave={(e: React.MouseEvent<HTMLDivElement>) => {
        if (!isActive) e.currentTarget.style.color = "#5A6888";
      }}
    >
      <span style={{ color: "#2A3555", fontSize: "0.75rem" }}>{getFileIcon(node.name)}</span>
      <span>{node.name}</span>
    </div>
  );
};

/* ============================================================
   TABS BAR
   ============================================================ */
interface TabsBarProps {
  tabs: Tab[];
  activeTabId: string;
  onTabClick: (id: string) => void;
  onTabClose: (id: string) => void;
}

const TabsBar = ({ tabs, activeTabId, onTabClick, onTabClose }: TabsBarProps): React.ReactElement => (
  <div style={{
    display: "flex", alignItems: "stretch",
    background: "#080B12",
    borderBottom: "1px solid #1A2033",
    overflowX: "auto", flexShrink: 0,
    height: 38,
  }}>
    {tabs.map((tab) => {
      const isActive = tab.id === activeTabId;
      const lang = tab.language;
      const color = LANG_COLORS[lang] || "#888";
      return (
        <div
          key={tab.id}
          onClick={() => onTabClick(tab.id)}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "0 14px", minWidth: 0, maxWidth: 180,
            background: isActive ? "#0C0F18" : "transparent",
            borderRight: "1px solid #1A2033",
            borderBottom: isActive ? "2px solid #00D4E8" : "2px solid transparent",
            cursor: "pointer", flexShrink: 0,
            transition: "background 0.15s",
          }}
        >
          <span style={{ fontSize: "0.65rem", fontFamily: "'JetBrains Mono', monospace", color, opacity: 0.8, flexShrink: 0 }}>
            {LANG_ICONS[lang] || "◦"}
          </span>
          <span style={{
            fontSize: "0.78rem", color: isActive ? "#C8D5E8" : "#5A6888",
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            fontFamily: "'DM Sans', sans-serif",
          }}>
            {tab.name}
          </span>
          {tab.isDirty && <span style={{ color: "#00D4E8", fontSize: "0.5rem", flexShrink: 0 }}>●</span>}
          <span
            onClick={(e: React.MouseEvent) => { e.stopPropagation(); onTabClose(tab.id); }}
            style={{
              color: "#2A3555", fontSize: "0.65rem",
              marginLeft: 2, padding: "1px 3px", borderRadius: 2,
              transition: "color 0.15s, background 0.15s",
              flexShrink: 0, lineHeight: 1,
            }}
            onMouseEnter={(e: React.MouseEvent<HTMLSpanElement>) => {
              e.currentTarget.style.color = "#C8D5E8";
              e.currentTarget.style.background = "#1A2033";
            }}
            onMouseLeave={(e: React.MouseEvent<HTMLSpanElement>) => {
              e.currentTarget.style.color = "#2A3555";
              e.currentTarget.style.background = "transparent";
            }}
          >✕</span>
        </div>
      );
    })}
  </div>
);

/* ============================================================
   CODE EDITOR (Monaco-powered with agentic workflow)
   ============================================================ */
interface CodeEditorProps {
  tab: Tab;
  onContentChange: (content: string) => void;
  pendingAction: CodeAction | null;
  onAcceptAction: () => void;
  onRejectAction: () => void;
  onCursorChange?: (line: number) => void;
  onSelectionChange?: (selection: string) => void;
}

const CodeEditorWrapper = ({
  tab,
  onContentChange,
  pendingAction,
  onAcceptAction,
  onRejectAction,
  onCursorChange,
  onSelectionChange,
}: CodeEditorProps): React.ReactElement => {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#0C0F18" }}>
      <MonacoEditor
        value={tab.content}
        language={tab.language}
        filename={tab.name}
        onChange={onContentChange}
        onCursorChange={(line) => onCursorChange?.(line)}
        onSelectionChange={(sel) => onSelectionChange?.(sel)}
        pendingAction={pendingAction}
        onAcceptAction={onAcceptAction}
        onRejectAction={onRejectAction}
      />
    </div>
  );
};

/* ============================================================
   MARKDOWN PANEL
   ============================================================ */
interface MarkdownPanelProps {
  content: string;
}

const MarkdownPanel = ({ content }: MarkdownPanelProps): React.ReactElement => {
  const renderMarkdown = (text: string): React.ReactElement[] => {
    return text.split("\n").map((line, i) => {
      if (line.startsWith("# ")) return <h1 key={i} style={{ fontFamily: "'Syne', sans-serif", fontSize: "1.3rem", fontWeight: 700, color: "#EEF4FF", marginBottom: 12, letterSpacing: "-0.02em" }}>{line.slice(2)}</h1>;
      if (line.startsWith("## ")) return <h2 key={i} style={{ fontFamily: "'Syne', sans-serif", fontSize: "1rem", fontWeight: 600, color: "#C8D5E8", marginTop: 16, marginBottom: 8 }}>{line.slice(3)}</h2>;
      if (line.startsWith("### ")) return <h3 key={i} style={{ fontSize: "0.9rem", fontWeight: 600, color: "#8A9BB8", marginTop: 12, marginBottom: 6 }}>{line.slice(4)}</h3>;
      if (line.startsWith("- ")) return <li key={i} style={{ color: "#8A9BB8", fontSize: "0.82rem", lineHeight: 1.6, marginLeft: 16, marginBottom: 4 }}>{line.slice(2)}</li>;
      if (line.startsWith("```")) return <div key={i} style={{ height: 1, background: "#1A2033", margin: "8px 0" }} />;
      if (line.trim() === "") return <div key={i} style={{ height: 8 }} />;
      return <p key={i} style={{ color: "#5A6888", fontSize: "0.82rem", lineHeight: 1.6, marginBottom: 4 }}>{line}</p>;
    });
  };

  return (
    <div style={{ height: "100%", overflow: "auto", padding: "20px 20px" }}>
      <div style={{
        fontSize: "0.65rem", fontFamily: "'JetBrains Mono', monospace",
        color: "#2A3555", letterSpacing: "0.08em", textTransform: "uppercase",
        marginBottom: 16, paddingBottom: 8, borderBottom: "1px solid #1A2033",
      }}>
        PREVIEW
      </div>
      {renderMarkdown(content)}
    </div>
  );
};

/* ============================================================
   STATUS BAR
   ============================================================ */
interface StatusBarProps {
  activeTab: Tab | null;
  fileCount: number;
  cursorPos: { line: number; col: number };
}

const StatusBar = ({ activeTab, fileCount, cursorPos }: StatusBarProps): React.ReactElement => (
  <div style={{
    height: 24, display: "flex", alignItems: "center",
    justifyContent: "space-between",
    background: "#060810",
    borderTop: "1px solid #0F1420",
    padding: "0 12px",
    fontSize: "0.65rem", fontFamily: "'JetBrains Mono', monospace",
    flexShrink: 0,
  }}>
    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
      {/* Branch */}
      <span style={{ display: "flex", alignItems: "center", gap: 4, color: "#00D4E8" }}>
        <span>⎇</span>
        <span>main</span>
      </span>
      <span style={{ color: "#2A3555" }}>|</span>
      <span style={{ color: "#3A4560" }}>{fileCount} files</span>
    </div>

    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
      {activeTab && (
        <>
          <span style={{ color: "#3A4560" }}>
            Ln {cursorPos.line}, Col {cursorPos.col}
          </span>
          <span style={{ color: "#2A3555" }}>|</span>
          <span style={{ color: "#3A4560" }}>UTF-8</span>
          <span style={{ color: "#2A3555" }}>|</span>
          <span style={{ color: LANG_COLORS[activeTab.language] || "#888", opacity: 0.8 }}>
            {activeTab.language.charAt(0).toUpperCase() + activeTab.language.slice(1)}
          </span>
        </>
      )}
      <span style={{ color: "#2A3555" }}>|</span>
      <span style={{ color: "#00E5A0", display: "flex", alignItems: "center", gap: 4 }}>
        <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#00E5A0", display: "inline-block", boxShadow: "0 0 4px #00E5A0" }} />
        AI Ready
      </span>
    </div>
  </div>
);

/* ============================================================
   ACTIVITY BAR (far left icon rail)
   ============================================================ */
interface ActivityBarProps {
  activePanel: string;
  onPanelChange: (panel: string) => void;
}

const ActivityBar = ({ activePanel, onPanelChange }: ActivityBarProps): React.ReactElement => {
  const icons = [
    { id: "explorer", icon: "◫", label: "Explorer" },
    { id: "search",   icon: "⌕", label: "Search"   },
    { id: "git",      icon: "⎇", label: "Git"       },
    { id: "debug",    icon: "⬡", label: "Debug"     },
  ];

  return (
    <div style={{
      width: 44, background: "#080B12",
      borderRight: "1px solid #1A2033",
      display: "flex", flexDirection: "column", alignItems: "center",
      paddingTop: 8, gap: 2, flexShrink: 0,
    }}>
      {icons.map((ic) => (
        <div
          key={ic.id}
          onClick={() => onPanelChange(ic.id)}
          title={ic.label}
          style={{
            width: 36, height: 36,
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", fontSize: "1.1rem",
            color: activePanel === ic.id ? "#C8D5E8" : "#3A4560",
            background: activePanel === ic.id ? "rgba(0,212,232,0.08)" : "transparent",
            borderLeft: activePanel === ic.id ? "2px solid #00D4E8" : "2px solid transparent",
            borderRadius: activePanel === ic.id ? "0 6px 6px 0" : "6px",
            transition: "all 0.15s",
          }}
          onMouseEnter={(e: React.MouseEvent<HTMLDivElement>) => {
            if (activePanel !== ic.id) e.currentTarget.style.color = "#8A9BB8";
          }}
          onMouseLeave={(e: React.MouseEvent<HTMLDivElement>) => {
            if (activePanel !== ic.id) e.currentTarget.style.color = "#3A4560";
          }}
        >
          {ic.icon}
        </div>
      ))}

      {/* Bottom icons */}
      <div style={{ flex: 1 }} />
      <div style={{
        width: 28, height: 28, borderRadius: "50%",
        background: "linear-gradient(135deg, #00D4E8, #00E5A0)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: "0.65rem", color: "#07090E", fontWeight: 700,
        marginBottom: 8, cursor: "pointer",
        fontFamily: "'Syne', sans-serif",
      }}>
        VI
      </div>
    </div>
  );
};

/* ============================================================
   SIDEBAR PANEL
   ============================================================ */
interface SidebarPanelProps {
  activePanel: string;
  fileTree: FileNode[];
  onFileClick: (node: FileNode) => void;
  activeFileId: string;
  sidebarWidth: number;
  onResize: (e: React.MouseEvent) => void;
  onOpenFolder?: () => void;
  folderName?: string;
  isLoading?: boolean;
}

const SidebarPanel = ({ activePanel, fileTree, onFileClick, activeFileId, sidebarWidth, onResize, onOpenFolder, folderName, isLoading }: SidebarPanelProps): React.ReactElement => (
  <div style={{
    width: sidebarWidth, background: "#0C0F18",
    borderRight: "1px solid #1A2033",
    display: "flex", flexDirection: "column",
    flexShrink: 0, position: "relative", overflow: "hidden",
  }}>
    {/* Header */}
    <div style={{
      padding: "8px 12px",
      fontSize: "0.65rem", fontFamily: "'JetBrains Mono', monospace",
      color: "#2A3555", letterSpacing: "0.1em", textTransform: "uppercase",
      borderBottom: "1px solid #1A2033", flexShrink: 0,
      display: "flex", justifyContent: "space-between", alignItems: "center",
    }}>
      <span>{activePanel.toUpperCase()}</span>
      <span style={{ color: "#1A2033", fontSize: "0.8rem", cursor: "pointer" }}>⋯</span>
    </div>

    {/* File tree */}
    <div style={{ flex: 1, overflow: "auto", paddingTop: 4 }}>
      {activePanel === "explorer" && fileTree.length === 0 && !isLoading && (
        <div style={{ padding: 16, display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
          <div style={{ color: "#2A3555", fontSize: "0.75rem", fontFamily: "'DM Sans', sans-serif", textAlign: "center" }}>
            No folder open
          </div>
          <button
            onClick={onOpenFolder}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              background: "rgba(0,212,232,0.1)", border: "1px solid rgba(0,212,232,0.3)",
              borderRadius: 6, padding: "8px 16px",
              color: "#00D4E8", cursor: "pointer",
              fontSize: "0.75rem", fontFamily: "'DM Sans', sans-serif",
              transition: "all 0.2s",
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = "rgba(0,212,232,0.2)";
              e.currentTarget.style.borderColor = "rgba(0,212,232,0.5)";
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = "rgba(0,212,232,0.1)";
              e.currentTarget.style.borderColor = "rgba(0,212,232,0.3)";
            }}
          >
            <span>📁</span>
            <span>Open Folder</span>
          </button>
          <div style={{ color: "#1A2033", fontSize: "0.65rem", fontFamily: "'JetBrains Mono', monospace", textAlign: "center", marginTop: 8 }}>
            or drag & drop a folder
          </div>
        </div>
      )}
      {activePanel === "explorer" && isLoading && (
        <div style={{ padding: 16, color: "#00D4E8", fontSize: "0.75rem", fontFamily: "'DM Sans', sans-serif", textAlign: "center" }}>
          Loading folder...
        </div>
      )}
      {activePanel === "explorer" && fileTree.length > 0 && (
        <>
          {folderName && (
            <div style={{ padding: "4px 12px", fontSize: "0.7rem", fontFamily: "'JetBrains Mono', monospace", color: "#00D4E8", borderBottom: "1px solid #1A2033", marginBottom: 4 }}>
              📁 {folderName}
            </div>
          )}
          {fileTree.map((node) => (
            <FileTreeNode key={node.id} node={node} depth={0} onFileClick={onFileClick} activeFileId={activeFileId} />
          ))}
        </>
      )}
      {activePanel === "search" && (
        <div style={{ padding: 12 }}>
          <input
            placeholder="Search files..."
            style={{
              width: "100%", background: "#111520",
              border: "1px solid #1A2033", borderRadius: 4,
              padding: "6px 10px", color: "#C8D5E8",
              fontFamily: "'JetBrains Mono', monospace", fontSize: "0.75rem",
              outline: "none",
            }}
          />
          <div style={{ color: "#2A3555", fontSize: "0.72rem", textAlign: "center", marginTop: 24, fontFamily: "'DM Sans', sans-serif" }}>
            Type to search files
          </div>
        </div>
      )}
      {activePanel === "git" && (
        <div style={{ padding: 12 }}>
          <div style={{ color: "#00E5A0", fontSize: "0.72rem", fontFamily: "'JetBrains Mono', monospace", marginBottom: 8 }}>
            ⎇ main
          </div>
          <div style={{ color: "#2A3555", fontSize: "0.72rem", fontFamily: "'DM Sans', sans-serif" }}>
            No changes to commit.
          </div>
        </div>
      )}
    </div>

    {/* Resize handle */}
    <div
      onMouseDown={onResize}
      style={{
        position: "absolute", right: 0, top: 0, bottom: 0, width: 4,
        cursor: "col-resize", zIndex: 10,
        transition: "background 0.15s",
      }}
      onMouseEnter={(e: React.MouseEvent<HTMLDivElement>) => (e.currentTarget.style.background = "rgba(0,212,232,0.3)")}
      onMouseLeave={(e: React.MouseEvent<HTMLDivElement>) => (e.currentTarget.style.background = "transparent")}
    />
  </div>
);

/* ============================================================
   TOP BAR
   ============================================================ */
interface TopBarProps {
  voiceOpen: boolean;
  onVoiceToggle: () => void;
}

const TopBar = ({ voiceOpen, onVoiceToggle }: TopBarProps): React.ReactElement => (
  <div style={{
    height: 40, background: "#080B12",
    borderBottom: "1px solid #1A2033",
    display: "flex", alignItems: "center",
    padding: "0 16px", gap: 16, flexShrink: 0,
  }}>
    {/* Logo */}
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginRight: 8 }}>
      <div style={{
        width: 22, height: 22, borderRadius: 5,
        background: "linear-gradient(135deg, #00D4E8, #00E5A0)",
        display: "flex", alignItems: "center", justifyContent: "center",
        boxShadow: "0 0 8px rgba(0,212,232,0.3)",
      }}>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M2 6L6 2L10 6L6 10Z" stroke="#07090E" strokeWidth="1.5" fill="none" />
        </svg>
      </div>
      <span style={{ fontFamily: "'Syne', sans-serif", fontSize: "0.82rem", fontWeight: 700, color: "#5A6888", letterSpacing: "-0.01em" }}>
        VoiceIDE
      </span>
    </div>

    {/* Menu items */}
    {["File", "Edit", "View", "Go", "Run", "Terminal", "Help"].map((item) => (
      <span
        key={item}
        style={{
          fontFamily: "'DM Sans', sans-serif", fontSize: "0.75rem",
          color: "#3A4560", cursor: "pointer", padding: "4px 6px",
          borderRadius: 3, transition: "color 0.15s, background 0.15s",
        }}
        onMouseEnter={(e: React.MouseEvent<HTMLSpanElement>) => {
          e.currentTarget.style.color = "#C8D5E8";
          e.currentTarget.style.background = "#1A2033";
        }}
        onMouseLeave={(e: React.MouseEvent<HTMLSpanElement>) => {
          e.currentTarget.style.color = "#3A4560";
          e.currentTarget.style.background = "transparent";
        }}
      >
        {item}
      </span>
    ))}

    <div style={{ flex: 1 }} />

    {/* Right side */}
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 6,
        background: "#111520", border: "1px solid #1A2033",
        borderRadius: 4, padding: "4px 10px",
        cursor: "pointer",
      }}>
        <span style={{ color: "#2A3555", fontSize: "0.7rem", fontFamily: "'JetBrains Mono', monospace" }}>⌘</span>
        <span style={{ color: "#3A4560", fontSize: "0.72rem", fontFamily: "'DM Sans', sans-serif" }}>Command Palette</span>
        <span style={{ color: "#2A3555", fontSize: "0.65rem", fontFamily: "'JetBrains Mono', monospace" }}>K</span>
      </div>

      {/* Voice toggle button */}
      <button
        onClick={onVoiceToggle}
        title="Toggle Voice Panel (Ctrl+Shift+V)"
        style={{
          display: "flex", alignItems: "center", gap: 6,
          background: voiceOpen ? "rgba(0,212,232,0.12)" : "transparent",
          border: `1px solid ${voiceOpen ? "rgba(0,212,232,0.4)" : "#1A2033"}`,
          borderRadius: 5, padding: "4px 10px",
          color: voiceOpen ? "#00D4E8" : "#3A4560",
          cursor: "pointer", transition: "all 0.2s",
          fontSize: "0.72rem", fontFamily: "'DM Sans', sans-serif",
        }}
        onMouseEnter={e => {
          if (!voiceOpen) {
            e.currentTarget.style.color = "#00D4E8";
            e.currentTarget.style.borderColor = "rgba(0,212,232,0.3)";
          }
        }}
        onMouseLeave={e => {
          if (!voiceOpen) {
            e.currentTarget.style.color = "#3A4560";
            e.currentTarget.style.borderColor = "#1A2033";
          }
        }}
      >
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none"
          stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
          <rect x="4" y="0.5" width="5" height="8" rx="2.5" />
          <path d="M1 6.5a5.5 5.5 0 0 0 11 0" />
          <line x1="6.5" y1="11" x2="6.5" y2="12.5" />
          <line x1="4.5" y1="12.5" x2="8.5" y2="12.5" />
        </svg>
        <span>Voice</span>
      </button>

      <div style={{
        width: 26, height: 26, borderRadius: "50%",
        background: "rgba(0,212,232,0.1)", border: "1px solid rgba(0,212,232,0.2)",
        display: "flex", alignItems: "center", justifyContent: "center",
        color: "#00D4E8", fontSize: "0.65rem",
        fontFamily: "'JetBrains Mono', monospace",
        cursor: "pointer",
      }}>
        ⚙
      </div>
    </div>
  </div>
);

/* ============================================================
   EMPTY STATE
   ============================================================ */
const EmptyState = (): React.ReactElement => (
  <div style={{
    flex: 1, display: "flex", flexDirection: "column",
    alignItems: "center", justifyContent: "center",
    background: "#0C0F18", color: "#2A3555",
  }}>
    <div style={{
      width: 60, height: 60, borderRadius: 16,
      background: "rgba(0,212,232,0.06)", border: "1px solid #1A2033",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: "1.8rem", marginBottom: 16,
    }}>
      ◫
    </div>
    <div style={{ fontFamily: "'Syne', sans-serif", fontSize: "0.9rem", fontWeight: 600, color: "#3A4560", marginBottom: 6 }}>
      No file open
    </div>
    <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "0.78rem", color: "#2A3555", textAlign: "center", maxWidth: 220 }}>
      Select a file from the explorer<br />or press <kbd style={{ background: "#1A2033", padding: "1px 5px", borderRadius: 3, fontFamily: "'JetBrains Mono', monospace", fontSize: "0.7rem", color: "#4DD9E8" }}>⌘K</kbd> to open
    </div>
  </div>
);

/* ============================================================
   GLOBAL STYLES FOR EDITOR PAGE
   ============================================================ */
const EditorStyles = (): React.ReactElement => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=DM+Sans:wght@300;400;500&family=JetBrains+Mono:wght@400;500&display=swap');

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      background: #07090E;
      color: #C8D5E8;
      font-family: 'DM Sans', sans-serif;
      overflow: hidden;
    }

    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: #1A2033; border-radius: 3px; }
    ::-webkit-scrollbar-thumb:hover { background: #2A3555; }

    input { outline: none; }
    button { outline: none; }

    @keyframes editorFadeIn {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .editor-ready {
      animation: editorFadeIn 0.5s ease forwards;
    }
  `}</style>
);

/* ============================================================
   COLLECT ALL FILES (flatten tree for easy lookup)
   ============================================================ */
function collectFiles(nodes: FileNode[]): FileNode[] {
  const result: FileNode[] = [];
  const walk = (n: FileNode): void => {
    if (n.type === "file") result.push(n);
    n.children?.forEach(walk);
  };
  nodes.forEach(walk);
  return result;
}

function countFiles(nodes: FileNode[]): number {
  return collectFiles(nodes).length;
}

/* ============================================================
   MAIN EDITOR PAGE
   ============================================================ */
export default function EditorPage(): React.ReactElement {
  const [booting, setBooting] = useState<boolean>(true);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>("");
  const [activePanel, setActivePanel] = useState<string>("explorer");
  const [activeFileId, setActiveFileId] = useState<string>("");
  const [sidebarWidth, setSidebarWidth] = useState<number>(220);
  const [showMarkdown, setShowMarkdown] = useState<boolean>(false);
  const [cursorPos, setCursorPos] = useState<{ line: number; col: number }>({ line: 1, col: 1 });
  const [selection, setSelection] = useState<string>("");
  const [pendingAction, setPendingAction] = useState<CodeAction | null>(null);

  /* ---- File system state ---- */
  const [fileTree, setFileTree] = useState<FileNode[]>([]); // Empty = no folder open
  const [folderName, setFolderName] = useState<string>("");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [rootHandle, setRootHandle] = useState<any>(null);
  const [isLoadingFolder, setIsLoadingFolder] = useState<boolean>(false);

  /* ---- Voice panel state (right-side panel) ---- */
  const [voiceOpen, setVoiceOpen]           = useState<boolean>(false);
  const [voicePanelW, setVoicePanelW]       = useState<number>(300);
  const [lastTranscript, setLastTranscript] = useState<string>("");
  const isVoiceResizing    = useRef<boolean>(false);
  const voiceResizeStartX  = useRef<number>(0);
  const voiceResizeStartW  = useRef<number>(300);

  const isResizing = useRef<boolean>(false);
  const startX = useRef<number>(0);
  const startWidth = useRef<number>(220);

  /* ----------------------------------------------------------------
     AI response handler — inserts / appends / replaces tab content
     ---------------------------------------------------------------- */
  const handleAIResponse = useCallback((response: AICommandResponse): void => {
    if (!response.code) return; // explain intent — no code insertion

    setTabs(prev => prev.map(tab => {
      if (tab.id !== activeTabId) return tab;

      let newContent = tab.content;
      switch (response.insertMode) {
        case "replace":
          newContent = response.code ?? tab.content;
          break;
        case "append":
          newContent = tab.content
            + (tab.content.endsWith("\n") ? "" : "\n")
            + "\n"
            + (response.code ?? "");
          break;
        case "cursor":
          /* Insert at first line if no cursor tracking yet */
          newContent = (response.code ?? "") + "\n" + tab.content;
          break;
        default:
          break;
      }
      return { ...tab, content: newContent, isDirty: true };
    }));
  }, [activeTabId]);

  /* ---- Keyboard shortcuts (Space = toggle mic, Ctrl+Shift+V = toggle panel) ---- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      /* Ignore when typing in inputs/textareas */
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;

      if (e.code === "Space" && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        e.preventDefault();
        setVoiceOpen(true); /* open panel; MicButton Space press handled inside VoicePanel */
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === "KeyV") {
        e.preventDefault();
        setVoiceOpen(v => !v);
      }
      if (e.code === "Escape" && voiceOpen) {
        setVoiceOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [voiceOpen]);

  /* ---- Voice panel resize (left-edge drag on right panel) ---- */
  useEffect(() => {
    const onMove = (e: MouseEvent): void => {
      if (!isVoiceResizing.current) return;
      const delta = voiceResizeStartX.current - e.clientX;
      setVoicePanelW(Math.max(220, Math.min(520, voiceResizeStartW.current + delta)));
    };
    const onUp = (): void => { isVoiceResizing.current = false; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  /* ---- Build editor context for VoicePanel ---- */
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;
  const editorContext: EditorContext = {
    language: activeTab?.language ?? "plaintext",
    filename: activeTab?.name ?? "untitled",
    currentCode: activeTab?.content ?? "",
    cursorLine: cursorPos.line,
    selection: selection,
  };

  // Open file - reads content from handle if available
  const handleFileOpen = useCallback(async (node: FileNode): Promise<void> => {
    console.log("[handleFileOpen] Opening file:", node.name, "handle:", !!node.handle, "content:", node.content?.length);
    if (node.type !== "file") return;

    setActiveFileId(node.id);

    // Check if tab already open
    const existing = tabs.find((t) => t.id === node.id);
    if (existing) {
      setActiveTabId(node.id);
      return;
    }

    // Read content from file handle if available (dynamic folder)
    let content = node.content || "";
    if (node.handle && !node.content) {
      try {
        console.log("[handleFileOpen] Reading content from handle...");
        content = await readFileContent(node.handle);
        console.log("[handleFileOpen] Read content length:", content.length);
      } catch (err) {
        console.error("Error reading file:", err);
        content = "// Error reading file";
      }
    }

    const newTab: Tab = {
      id: node.id,
      name: node.name,
      language: node.language || getLanguage(node.name),
      content,
      isDirty: false,
    };

    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(node.id);
    setShowMarkdown(false);
  }, [tabs]);

  // Boot complete handler
  const handleBootComplete = useCallback((): void => {
    setBooting(false);
  }, []);

  // Handle opening a folder from the file system
  const handleOpenFolder = useCallback(async (): Promise<void> => {
    setIsLoadingFolder(true);
    try {
      const handle = await openFolderPicker();
      if (!handle) {
        setIsLoadingFolder(false);
        return;
      }
      
      setRootHandle(handle);
      setFolderName(handle.name);
      
      // Read the directory tree
      const tree = await readDirectory(handle);
      setFileTree(tree as unknown as FileNode[]);
    } catch (err) {
      console.error("Error opening folder:", err);
    } finally {
      setIsLoadingFolder(false);
    }
  }, []);

  const handleTabClose = (id: string): void => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      const next = prev.filter((t) => t.id !== id);
      if (activeTabId === id && next.length > 0) {
        const newActive = next[Math.min(idx, next.length - 1)];
        setActiveTabId(newActive.id);
        setActiveFileId(newActive.id);
      } else if (next.length === 0) {
        setActiveTabId("");
        setActiveFileId("");
      }
      return next;
    });
  };

  // Handle content changes from Monaco editor
  const handleContentChange = useCallback((content: string): void => {
    setTabs(prev => prev.map(tab => {
      if (tab.id !== activeTabId) return tab;
      return { ...tab, content, isDirty: true };
    }));
  }, [activeTabId]);

  // Handle accepting pending code action
  const handleAcceptAction = useCallback((): void => {
    if (!pendingAction || !activeTab) return;
    
    let newContent = activeTab.content;
    switch (pendingAction.action) {
      case "insert": {
        const line = pendingAction.insert_at_line || cursorPos.line;
        const lines = activeTab.content.split("\n");
        lines.splice(line - 1, 0, pendingAction.code);
        newContent = lines.join("\n");
        break;
      }
      case "replace_selection":
      case "replace_file":
        newContent = pendingAction.code;
        break;
      case "delete_lines": {
        const start = pendingAction.start_line || 1;
        const end = pendingAction.end_line || start;
        const lines = activeTab.content.split("\n");
        lines.splice(start - 1, end - start + 1);
        newContent = lines.join("\n");
        break;
      }
    }
    
    setTabs(prev => prev.map(tab => {
      if (tab.id !== activeTabId) return tab;
      return { ...tab, content: newContent, isDirty: true };
    }));
    setPendingAction(null);
  }, [pendingAction, activeTab, activeTabId, cursorPos.line]);

  // Handle rejecting pending code action
  const handleRejectAction = useCallback((): void => {
    setPendingAction(null);
  }, []);

  // Sidebar resize
  const handleResizeStart = (e: React.MouseEvent): void => {
    isResizing.current = true;
    startX.current = e.clientX;
    startWidth.current = sidebarWidth;
    e.preventDefault();
  };

  useEffect(() => {
    const onMove = (e: MouseEvent): void => {
      if (!isResizing.current) return;
      const delta = e.clientX - startX.current;
      setSidebarWidth(Math.max(160, Math.min(400, startWidth.current + delta)));
    };
    const onUp = (): void => { isResizing.current = false; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const totalFiles = countFiles(VIRTUAL_FS);

  return (
    <>
      <EditorStyles />

      {/* Boot screen */}
      {booting && <BootScreen onComplete={handleBootComplete} />}

      {/* IDE Shell */}
      <div
        className={!booting ? "editor-ready" : ""}
        style={{
          width: "100vw", height: "100vh",
          display: "flex", flexDirection: "column",
          background: "#07090E",
          opacity: booting ? 0 : 1,
        }}
      >
        {/* Top menu bar */}
        <TopBar voiceOpen={voiceOpen} onVoiceToggle={() => setVoiceOpen(v => !v)} />

        {/* Main area */}
        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
          {/* Activity bar */}
          <ActivityBar activePanel={activePanel} onPanelChange={setActivePanel} />

          {/* Sidebar */}
          <SidebarPanel
            activePanel={activePanel}
            fileTree={fileTree}
            onFileClick={handleFileOpen}
            activeFileId={activeFileId}
            sidebarWidth={sidebarWidth}
            onResize={handleResizeStart}
            onOpenFolder={handleOpenFolder}
            folderName={folderName}
            isLoading={isLoadingFolder}
          />

          {/* ── Center: Editor column ── */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
            {/* Tabs bar + MD preview toggle */}
            {tabs.length > 0 && (
              <div style={{ display: "flex", alignItems: "center", background: "#080B12", borderBottom: "1px solid #1A2033", flexShrink: 0 }}>
                <div style={{ flex: 1, overflow: "hidden" }}>
                  <TabsBar
                    tabs={tabs}
                    activeTabId={activeTabId}
                    onTabClick={setActiveTabId}
                    onTabClose={handleTabClose}
                  />
                </div>
                {/* Markdown preview button — only when a .md file is active */}
                {activeTab?.language === "markdown" && (
                  <button
                    onClick={() => setShowMarkdown(v => !v)}
                    title={showMarkdown ? "Close MD preview" : "Open MD preview"}
                    style={{
                      flexShrink: 0,
                      display: "flex", alignItems: "center", gap: 5,
                      background: showMarkdown ? "rgba(0,212,232,0.1)" : "transparent",
                      border: `1px solid ${showMarkdown ? "rgba(0,212,232,0.35)" : "#1A2033"}`,
                      borderRadius: 4, margin: "0 8px",
                      padding: "3px 10px",
                      color: showMarkdown ? "#00D4E8" : "#3A4560",
                      fontSize: "0.7rem", fontFamily: "'DM Sans', sans-serif",
                      cursor: "pointer", transition: "all 0.2s", whiteSpace: "nowrap",
                    }}
                    onMouseEnter={e => { if (!showMarkdown) { e.currentTarget.style.color = "#00D4E8"; e.currentTarget.style.borderColor = "rgba(0,212,232,0.3)"; }}}
                    onMouseLeave={e => { if (!showMarkdown) { e.currentTarget.style.color = "#3A4560"; e.currentTarget.style.borderColor = "#1A2033"; }}}
                  >
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
                      <rect x="1" y="1" width="10" height="10" rx="1.5" />
                      <line x1="3" y1="4" x2="9" y2="4" />
                      <line x1="3" y1="6" x2="9" y2="6" />
                      <line x1="3" y1="8" x2="7" y2="8" />
                    </svg>
                    {showMarkdown ? "Close Preview" : "Preview MD"}
                  </button>
                )}
              </div>
            )}

            {/* Editor + Markdown split */}
            <div style={{ flex: 1, display: "flex", overflow: "hidden", minHeight: 0 }}>
              {/* Code editor */}
              <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", minWidth: 0 }}>
                {activeTab ? (
                  <CodeEditorWrapper
                    tab={activeTab}
                    onContentChange={handleContentChange}
                    pendingAction={pendingAction}
                    onAcceptAction={handleAcceptAction}
                    onRejectAction={handleRejectAction}
                    onCursorChange={(line) => setCursorPos(prev => ({ ...prev, line }))}
                    onSelectionChange={setSelection}
                  />
                ) : (
                  <EmptyState />
                )}
              </div>

              {/* Markdown preview — only when toggled on AND file is .md */}
              {showMarkdown && activeTab?.language === "markdown" && (
                <div style={{
                  flex: "0 0 50%",
                  borderLeft: "1px solid #1A2033",
                  background: "#0C0F18",
                  overflow: "hidden",
                  display: "flex", flexDirection: "column",
                  minWidth: 0,
                }}>
                  <div style={{
                    padding: "0 12px", height: 36,
                    background: "#080B12", borderBottom: "1px solid #1A2033",
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    flexShrink: 0,
                  }}>
                    <span style={{ fontSize: "0.62rem", fontFamily: "'JetBrains Mono', monospace", color: "#2A3555", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                      Markdown Preview
                    </span>
                    <span
                      onClick={() => setShowMarkdown(false)}
                      style={{ color: "#2A3555", fontSize: "0.7rem", cursor: "pointer", transition: "color 0.15s" }}
                      onMouseEnter={(e: React.MouseEvent<HTMLSpanElement>) => (e.currentTarget.style.color = "#C8D5E8")}
                      onMouseLeave={(e: React.MouseEvent<HTMLSpanElement>) => (e.currentTarget.style.color = "#2A3555")}
                    >
                      ✕
                    </span>
                  </div>
                  <MarkdownPanel content={activeTab.content} />
                </div>
              )}
            </div>
          </div>

          {/* ── Right: Voice Panel (like VS Code secondary sidebar) ── */}
          {voiceOpen && (
            <div style={{ display: "flex", flexShrink: 0, width: voicePanelW, position: "relative" }}>
              {/* Left-edge drag-resize handle */}
              <div
                onMouseDown={e => {
                  isVoiceResizing.current = true;
                  voiceResizeStartX.current = e.clientX;
                  voiceResizeStartW.current = voicePanelW;
                  e.preventDefault();
                }}
                style={{
                  position: "absolute", left: 0, top: 0, bottom: 0, width: 4,
                  cursor: "col-resize", zIndex: 10,
                  transition: "background 0.15s",
                }}
                onMouseEnter={e => (e.currentTarget.style.background = "rgba(0,212,232,0.35)")}
                onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
              />
              <div style={{ flex: 1, paddingLeft: 4, borderLeft: "1px solid #1A2033", overflow: "hidden", display: "flex", flexDirection: "column" }}>
                <VoicePanel
                  editorContext={editorContext}
                  onAIResponse={handleAIResponse}
                  onTranscriptChange={setLastTranscript}
                  onCodeAction={(action) => {
                    // Convert CodeActionData to CodeAction format for Monaco
                    setPendingAction({
                      action: action.action,
                      code: action.code,
                      insert_at_line: action.insert_at_line,
                      start_line: action.start_line,
                      end_line: action.end_line,
                      explanation: action.explanation,
                    });
                  }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Status bar */}
        <StatusBar activeTab={activeTab} fileCount={totalFiles} cursorPos={cursorPos} />

        {/* ── Floating transcript badge (when voice panel is closed but listening) ── */}
        {!voiceOpen && lastTranscript && (
          <div
            onClick={() => setVoiceOpen(true)}
            style={{
              position: "fixed", bottom: 36, right: 16, zIndex: 200,
              background: "rgba(0,212,232,0.12)", border: "1px solid rgba(0,212,232,0.35)",
              borderRadius: 8, padding: "6px 12px",
              display: "flex", alignItems: "center", gap: 8,
              cursor: "pointer", maxWidth: 320,
              backdropFilter: "blur(8px)",
              animation: "editorFadeIn 0.25s ease forwards",
            }}
          >
            <span style={{ color: "#00D4E8", fontSize: "0.7rem", fontFamily: "'JetBrains Mono', monospace", flexShrink: 0 }}>🎙</span>
            <span style={{
              color: "#8A9BB8", fontSize: "0.72rem",
              fontFamily: "'DM Sans', sans-serif",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>{lastTranscript}</span>
            <span
              onClick={e => { e.stopPropagation(); setLastTranscript(""); }}
              style={{ color: "#3A4560", fontSize: "0.65rem", cursor: "pointer", flexShrink: 0 }}
            >✕</span>
          </div>
        )}
      </div>
    </>
  );
}