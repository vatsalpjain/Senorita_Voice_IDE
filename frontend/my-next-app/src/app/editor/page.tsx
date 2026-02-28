"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import dynamic from "next/dynamic";
import { VoicePanel, ChatMessage, CodeChange, AIMode } from "../../components/VoicePanel";
import { ConversationSummary, ConversationSummaryData } from "../../components/ConversationSummary";
import Link from "next/link";
import { pushActivity } from "../../store/activityStore";
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
import { registerFile, unregisterFile, registerFilesBatch, clearFileRegistry, getFileFromRegistry } from "../../services/fileRegistryService";
import { saveWorkspace } from "../../store/workspaceStore";

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
  path?: string;
}

interface PendingFileEdit {
  action: "insert" | "replace_selection" | "replace_file" | "create_file" | "delete_lines";
  code: string;
  insert_at_line?: number;
  start_line?: number;
  end_line?: number;
  explanation?: string;
  file_path: string;  // The target file path
}

interface Tab {
  id: string;
  name: string;
  language: string;
  content: string;
  isDirty: boolean;
  pendingEdit?: PendingFileEdit | null;  // Pending edit for this specific file
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
  ".tsx": "__TSX__",
  ".ts":  "__TS__",
  ".jsx": "__JSX__",
  ".js":  "__JS__",
  ".css": "__CSS__",
  ".md":  "__MD__",
  ".json":"__JSON__",
  ".env": "🔒",
  ".local":"🔒",
  ".py":  "__PY__",
  ".sh":  "⚙️",
  ".yml": "⚙️",
  ".yaml":"⚙️",
  ".toml":"⚙️",
  ".lock":"🔒",
  ".html":"__HTML__",
  ".svg": "🖼️",
  ".png": "🖼️",
  ".jpg": "🖼️",
  ".txt": "📄",
  ".mjs": "__JS__",
  ".cjs": "__JS__",
  ".rs":  "🦀",
  ".go":  "🐹",
  ".java":"☕",
  ".sql": "🗄️",
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
      <span style={{ color: "#2A3555", width: 40, textAlign: "right", paddingRight: 16, userSelect: "none", flexShrink: 0, fontSize: "0.82rem" }}>
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
  { label: "Initializing workspace...",        duration: 250  },
  { label: "Loading virtual file system...",   duration: 350  },
  { label: "Starting Monaco Engine...",        duration: 300  },
  { label: "Connecting AI pipeline...",        duration: 250  },
  { label: "Calibrating voice interface...",   duration: 200  },
  { label: "Ready.",                           duration: 150  },
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
      await new Promise<void>((res) => setTimeout(res, 400));
      setDone(true);
      await new Promise<void>((res) => setTimeout(res, 100));
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
        position: "relative", marginBottom: 24,
        animation: "bootPulse 2s ease-in-out infinite",
        zIndex: 2,
      }}>
        <img
          src="/logo3.png"
          alt="Senorita"
          style={{ width: 340, height: "auto", objectFit: "contain", display: "block", mixBlendMode: "screen" }}
        />
      </div>

      {/* Voice waveform */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, height: 90, width: 500, justifyContent: "center", marginBottom: 24, zIndex: 1 }}>
        {[0.4,0.65,0.85,0.95,0.75,0.9,1,0.7,0.85,0.6,0.9,0.8,0.95,1,0.7,0.85,0.6,0.95,0.75,0.9,1,0.65,0.85,0.7,0.95].map((h, i) => (
          <div key={i} style={{
            flex: 1,
            maxWidth: 6,
            minWidth: 3,
            height: `${h * 100}%`,
            borderRadius: 99,
            background: `linear-gradient(180deg, #00FFFF 0%, #00D4E8 40%, rgba(0,212,232,0.15) 100%)`,
            boxShadow: `0 0 7px rgba(0,212,232,0.6), 0 0 16px rgba(0,212,232,0.2)`,
            animation: `bootWaveBar 1.5s ease-in-out ${i * 0.08}s infinite`,
            transformOrigin: "center",
          }} />
        ))}
      </div>

      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "0.78rem", color: "#2A3555", marginBottom: 48, letterSpacing: "0.08em" }}>
        v0.1.0 — hackathon edition
      </div>

      {/* Boot log */}
      <div style={{ width: 400, marginBottom: 32 }}>
        {BOOT_PHASES.map((p, i) => (
          <div key={i} style={{
            display: "flex", alignItems: "center", gap: 10,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: "0.78rem", marginBottom: 6,
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
          fontFamily: "'JetBrains Mono', monospace", fontSize: "0.72rem", color: "#2A3555",
        }}>
          <span>Loading workspace</span>
          <span>{Math.round(progress)}%</span>
        </div>
      </div>

      <style>{`
        @keyframes bootWaveBar {
          0%,100% { transform: scaleY(0.2); opacity: 0.35; }
          50%     { transform: scaleY(1); opacity: 0.85; }
        }
        @keyframes bootPulse {
          0%,100% { transform: scale(1); }
          50% { transform: scale(1.03); }
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
          onMouseEnter={(e: React.MouseEvent<HTMLDivElement>) => (e.currentTarget.style.color = "#E2E8F0")}
          onMouseLeave={(e: React.MouseEvent<HTMLDivElement>) => (e.currentTarget.style.color = "#8A9BB8")}
        >
          <span style={{ fontSize: "0.68rem", transition: "transform 0.15s", display: "inline-block", transform: open ? "rotate(90deg)" : "rotate(0deg)" }}>▶</span>
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
        color: isActive ? "#E2E8F0" : "#8A9BB8",
        transition: "all 0.15s",
        borderRadius: "0 4px 4px 0",
      }}
      onMouseEnter={(e: React.MouseEvent<HTMLDivElement>) => {
        if (!isActive) e.currentTarget.style.color = "#E2E8F0";
      }}
      onMouseLeave={(e: React.MouseEvent<HTMLDivElement>) => {
        if (!isActive) e.currentTarget.style.color = "#8A9BB8";
      }}
    >
      {(() => {
        const icon = getFileIcon(node.name);
        if (icon === "__PY__") return (
          <svg width="14" height="14" viewBox="0 0 256 255" style={{ flexShrink: 0 }}>
            <defs>
              <linearGradient id="pyB" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#387EB8"/><stop offset="100%" stopColor="#366994"/></linearGradient>
              <linearGradient id="pyY" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#FFE052"/><stop offset="100%" stopColor="#FFC331"/></linearGradient>
            </defs>
            <path fill="url(#pyB)" d="M126.9 0C62.4 0 66.3 27.3 66.3 27.3l.1 28.3h61.8v8.5H43.7S0 59.1 0 124.3s37.9 62.9 37.9 62.9H60v-30.3s-1.3-37.9 37.3-37.9h64.3s36.1.6 36.1-34.9V36.4S203.1 0 126.9 0zM92.6 20.9a11.9 11.9 0 110 23.8 11.9 11.9 0 010-23.8z"/>
            <path fill="url(#pyY)" d="M129.1 255c64.5 0 60.6-27.3 60.6-27.3l-.1-28.3H127.8v-8.5h84.5S256 196 256 130.7s-37.9-62.9-37.9-62.9H196v30.3s1.3 37.9-37.3 37.9H94.4S58.3 135.4 58.3 170.9v62.7S52.9 255 129.1 255zm34.3-20.9a11.9 11.9 0 110-23.8 11.9 11.9 0 010 23.8z"/>
          </svg>
        );
        if (icon === "__TS__" || icon === "__TSX__") return (
          <svg width="14" height="14" viewBox="0 0 400 400" style={{ flexShrink: 0 }}>
            <rect width="400" height="400" rx="50" fill="#3178C6"/>
            <text x="200" y="300" textAnchor="middle" fill="white" fontSize="210" fontWeight="900" fontFamily="'Arial Black',sans-serif">
              {icon === "__TSX__" ? "TSX" : "TS"}
            </text>
          </svg>
        );
        if (icon === "__JS__" || icon === "__JSX__") return (
          <svg width="14" height="14" viewBox="0 0 400 400" style={{ flexShrink: 0 }}>
            <rect width="400" height="400" rx="50" fill="#F7DF1E"/>
            <text x="200" y="310" textAnchor="middle" fill="#000" fontSize="210" fontWeight="900" fontFamily="'Arial Black',sans-serif">JS</text>
          </svg>
        );
        if (icon === "__CSS__") return (
          <svg width="14" height="14" viewBox="0 0 400 400" style={{ flexShrink: 0 }}>
            <rect width="400" height="400" rx="50" fill="#264DE4"/>
            <text x="200" y="310" textAnchor="middle" fill="white" fontSize="190" fontWeight="900" fontFamily="'Arial Black',sans-serif">CSS</text>
          </svg>
        );
        if (icon === "__JSON__") return (
          <svg width="14" height="14" viewBox="0 0 400 400" style={{ flexShrink: 0 }}>
            <rect width="400" height="400" rx="50" fill="#8BC34A"/>
            <text x="200" y="300" textAnchor="middle" fill="white" fontSize="180" fontWeight="900" fontFamily="'Arial Black',sans-serif">{"{ }"}</text>
          </svg>
        );
        if (icon === "__MD__") return (
          <svg width="14" height="14" viewBox="0 0 208 128" style={{ flexShrink: 0 }}>
            <rect width="208" height="128" rx="16" fill="#083FA1"/>
            <text x="104" y="96" textAnchor="middle" fill="white" fontSize="80" fontWeight="900" fontFamily="'Arial Black',sans-serif">MD</text>
          </svg>
        );
        if (icon === "__HTML__") return (
          <svg width="14" height="14" viewBox="0 0 400 400" style={{ flexShrink: 0 }}>
            <rect width="400" height="400" rx="50" fill="#E34F26"/>
            <text x="200" y="300" textAnchor="middle" fill="white" fontSize="160" fontWeight="900" fontFamily="'Arial Black',sans-serif">HTML</text>
          </svg>
        );
        return <span style={{ fontSize: "0.85rem", lineHeight: 1 }}>{icon}</span>;
      })()}
      <span style={{ color: isActive ? "#E2E8F0" : "#8A9BB8" }}>{node.name}</span>
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
          <span style={{ fontSize: "0.72rem", fontFamily: "'JetBrains Mono', monospace", color, opacity: 0.8, flexShrink: 0 }}>
            {LANG_ICONS[lang] || "◦"}
          </span>
          <span style={{
            fontSize: "0.85rem", color: isActive ? "#C8D5E8" : "#5A6888",
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            fontFamily: "'DM Sans', sans-serif",
          }}>
            {tab.name}
          </span>
          {tab.isDirty && <span style={{ color: "#00D4E8", fontSize: "0.5rem", flexShrink: 0 }}>●</span>}
          <span
            onClick={(e: React.MouseEvent) => { e.stopPropagation(); onTabClose(tab.id); }}
            style={{
              color: "#2A3555", fontSize: "0.72rem",
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
  onSendToChat?: (code: string) => void;
}

const CodeEditorWrapper = ({
  tab,
  onContentChange,
  pendingAction,
  onAcceptAction,
  onRejectAction,
  onCursorChange,
  onSelectionChange,
  onSendToChat,
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
        onSendToChat={onSendToChat}
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
      if (line.startsWith("- ")) return <li key={i} style={{ color: "#8A9BB8", fontSize: "0.88rem", lineHeight: 1.6, marginLeft: 16, marginBottom: 4 }}>{line.slice(2)}</li>;
      if (line.startsWith("```")) return <div key={i} style={{ height: 1, background: "#1A2033", margin: "8px 0" }} />;
      if (line.trim() === "") return <div key={i} style={{ height: 8 }} />;
      return <p key={i} style={{ color: "#5A6888", fontSize: "0.88rem", lineHeight: 1.6, marginBottom: 4 }}>{line}</p>;
    });
  };

  return (
    <div style={{ height: "100%", overflow: "auto", padding: "20px 20px" }}>
      <div style={{
        fontSize: "0.72rem", fontFamily: "'JetBrains Mono', monospace",
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
    fontSize: "0.72rem", fontFamily: "'JetBrains Mono', monospace",
    flexShrink: 0,
  }}>
    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
      {/* Branch */}
      <span style={{ display: "flex", alignItems: "center", gap: 4, color: "#00D4E8" }}>
        <span>⎇</span>
        <span>main</span>
      </span>
      <span style={{ color: "#2A3555" }}>|</span>
      <span style={{ color: "#5A6888" }}>{fileCount} files</span>
    </div>

    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
      {activeTab && (
        <>
          <span style={{ color: "#5A6888" }}>
            Ln {cursorPos.line}, Col {cursorPos.col}
          </span>
          <span style={{ color: "#3A4560" }}>|</span>
          <span style={{ color: "#5A6888" }}>UTF-8</span>
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

const ACTIVITY_ICONS: Record<string, React.ReactElement> = {
  explorer: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
      <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
    </svg>
  ),
  search: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
    </svg>
  ),
  git: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="6" cy="6" r="2.5"/>
      <path d="M6 8.5v7M8.5 6h7"/>
    </svg>
  ),
  debug: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 22 19 2 19"/>
      <line x1="12" y1="9" x2="12" y2="14"/><circle cx="12" cy="17" r="0.8" fill="currentColor"/>
    </svg>
  ),
};

const ActivityBar = ({ activePanel, onPanelChange }: ActivityBarProps): React.ReactElement => {
  const icons = [
    { id: "explorer", label: "Explorer" },
    { id: "search",   label: "Search"   },
    { id: "git",      label: "Git"      },
    { id: "debug",    label: "Debug"    },
  ];

  return (
    <div style={{
      width: 48, background: "#080B12",
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
            width: 40, height: 40,
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer",
            color: activePanel === ic.id ? "#00D4E8" : "#4A5A75",
            background: activePanel === ic.id ? "rgba(0,212,232,0.1)" : "transparent",
            borderLeft: activePanel === ic.id ? "2px solid #00D4E8" : "2px solid transparent",
            borderRadius: activePanel === ic.id ? "0 6px 6px 0" : "6px",
            transition: "all 0.15s",
          }}
          onMouseEnter={(e: React.MouseEvent<HTMLDivElement>) => {
            if (activePanel !== ic.id) e.currentTarget.style.color = "#C8D5E8";
          }}
          onMouseLeave={(e: React.MouseEvent<HTMLDivElement>) => {
            if (activePanel !== ic.id) e.currentTarget.style.color = "#4A5A75";
          }}
        >
          {ACTIVITY_ICONS[ic.id]}
        </div>
      ))}

      {/* Bottom icons */}
      <div style={{ flex: 1 }} />
      <div style={{
        width: 28, height: 28, borderRadius: "50%",
        background: "linear-gradient(135deg, #00D4E8, #00E5A0)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: "0.72rem", color: "#07090E", fontWeight: 700,
        marginBottom: 8, cursor: "pointer",
        fontFamily: "'Syne', sans-serif",
      }}>
        VI
      </div>
    </div>
  );
};

/* ============================================================
   SEARCH PANEL
   ============================================================ */
interface SearchResult {
  fileId: string;
  fileName: string;
  matchType: "name" | "content";
  preview: string;
  node: FileNode;
}

function collectAllFiles(nodes: FileNode[]): FileNode[] {
  const result: FileNode[] = [];
  for (const node of nodes) {
    if (node.type === "file") {
      result.push(node);
    } else if (node.children) {
      result.push(...collectAllFiles(node.children));
    }
  }
  return result;
}

const SearchPanel = ({
  fileTree,
  onFileClick,
}: {
  fileTree: FileNode[];
  onFileClick: (node: FileNode) => void;
}): React.ReactElement => {
  const [query, setQuery] = useState<string>("");
  const [results, setResults] = useState<SearchResult[]>([]);

  const runSearch = (q: string) => {
    if (!q.trim()) { setResults([]); return; }
    const lower = q.toLowerCase();
    const allFiles = collectAllFiles(fileTree);
    const found: SearchResult[] = [];

    for (const file of allFiles) {
      // Match filename
      if (file.name.toLowerCase().includes(lower)) {
        found.push({
          fileId: file.id,
          fileName: file.name,
          matchType: "name",
          preview: file.name,
          node: file,
        });
        continue;
      }
      // Match content
      if (file.content) {
        const lines = file.content.split("\n");
        const matchLine = lines.find(l => l.toLowerCase().includes(lower));
        if (matchLine) {
          found.push({
            fileId: file.id,
            fileName: file.name,
            matchType: "content",
            preview: matchLine.trim().slice(0, 60),
            node: file,
          });
        }
      }
    }
    setResults(found.slice(0, 40));
  };

  return (
    <div style={{ padding: "10px 10px 0" }}>
      <div style={{ position: "relative", marginBottom: 8 }}>
        <span style={{
          position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)",
          color: "#5A6888", fontSize: "0.82rem", pointerEvents: "none",
        }}>⌕</span>
        <input
          autoFocus
          value={query}
          onChange={e => { setQuery(e.target.value); runSearch(e.target.value); }}
          placeholder="Search files & contents…"
          style={{
            width: "100%", background: "#111520",
            border: "1px solid #2A3555", borderRadius: 6,
            padding: "7px 10px 7px 26px", color: "#C8D5E8",
            fontFamily: "'JetBrains Mono', monospace", fontSize: "0.73rem",
            outline: "none", boxSizing: "border-box",
            transition: "border-color 0.15s",
          }}
          onFocus={e => (e.currentTarget.style.borderColor = "#00D4E8")}
          onBlur={e => (e.currentTarget.style.borderColor = "#2A3555")}
        />
      </div>

      {query.trim() === "" && (
        <div style={{ color: "#3A4560", fontSize: "0.78rem", textAlign: "center", marginTop: 20, fontFamily: "'DM Sans', sans-serif" }}>
          Type to search file names or contents
        </div>
      )}

      {query.trim() !== "" && results.length === 0 && (
        <div style={{ color: "#3A4560", fontSize: "0.78rem", textAlign: "center", marginTop: 20, fontFamily: "'DM Sans', sans-serif" }}>
          No results for &ldquo;{query}&rdquo;
        </div>
      )}

      {results.map(r => (
        <div
          key={r.fileId + r.matchType}
          onClick={() => onFileClick(r.node)}
          style={{
            padding: "6px 8px", borderRadius: 5, cursor: "pointer",
            marginBottom: 2, transition: "background 0.12s",
            border: "1px solid transparent",
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = "rgba(0,212,232,0.07)";
            e.currentTarget.style.borderColor = "rgba(0,212,232,0.2)";
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.borderColor = "transparent";
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: r.matchType === "content" ? 2 : 0 }}>
            <span style={{ fontSize: "0.8rem" }}>{getFileIcon(r.fileName)}</span>
            <span style={{ color: "#C8D5E8", fontSize: "0.82rem", fontFamily: "'DM Sans', sans-serif", fontWeight: 500 }}>
              {r.fileName}
            </span>
            <span style={{
              marginLeft: "auto", fontSize: "0.66rem",
              fontFamily: "'JetBrains Mono', monospace",
              color: r.matchType === "name" ? "#00D4E8" : "#a78bfa",
              background: r.matchType === "name" ? "rgba(0,212,232,0.1)" : "rgba(167,139,250,0.1)",
              padding: "1px 5px", borderRadius: 3,
            }}>
              {r.matchType === "name" ? "name" : "match"}
            </span>
          </div>
          {r.matchType === "content" && (
            <div style={{
              color: "#5A6888", fontSize: "0.75rem",
              fontFamily: "'JetBrains Mono', monospace",
              paddingLeft: 22, overflow: "hidden",
              textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {r.preview}
            </div>
          )}
        </div>
      ))}
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
      fontSize: "0.72rem", fontFamily: "'JetBrains Mono', monospace",
      color: "#2A3555", letterSpacing: "0.1em", textTransform: "uppercase",
      borderBottom: "1px solid #1A2033", flexShrink: 0,
      display: "flex", justifyContent: "space-between", alignItems: "center",
    }}>
      <span style={{ color: "#5A6888" }}>{activePanel.toUpperCase()}</span>
      <span style={{ color: "#3A4560", fontSize: "0.8rem", cursor: "pointer" }}>⋯</span>
    </div>

    {/* File tree */}
    <div style={{ flex: 1, overflow: "auto", paddingTop: 4 }}>
      {activePanel === "explorer" && fileTree.length === 0 && !isLoading && (
        <div style={{ padding: 16, display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
          <div style={{ color: "#2A3555", fontSize: "0.82rem", fontFamily: "'DM Sans', sans-serif", textAlign: "center" }}>
            No folder open
          </div>
          <button
            onClick={onOpenFolder}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              background: "rgba(0,212,232,0.1)", border: "1px solid rgba(0,212,232,0.3)",
              borderRadius: 6, padding: "8px 16px",
              color: "#00D4E8", cursor: "pointer",
              fontSize: "0.82rem", fontFamily: "'DM Sans', sans-serif",
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
          <div style={{ color: "#1A2033", fontSize: "0.72rem", fontFamily: "'JetBrains Mono', monospace", textAlign: "center", marginTop: 8 }}>
            or drag & drop a folder
          </div>
        </div>
      )}
      {activePanel === "explorer" && isLoading && (
        <div style={{ padding: 16, color: "#00D4E8", fontSize: "0.82rem", fontFamily: "'DM Sans', sans-serif", textAlign: "center" }}>
          Loading folder...
        </div>
      )}
      {activePanel === "explorer" && fileTree.length > 0 && (
        <>
          {folderName && (
            <div style={{ padding: "4px 12px", fontSize: "0.78rem", fontFamily: "'JetBrains Mono', monospace", color: "#00D4E8", borderBottom: "1px solid #1A2033", marginBottom: 4 }}>
              📁 {folderName}
            </div>
          )}
          {fileTree.map((node) => (
            <FileTreeNode key={node.id} node={node} depth={0} onFileClick={onFileClick} activeFileId={activeFileId} />
          ))}
        </>
      )}
      {activePanel === "search" && (
        <SearchPanel fileTree={fileTree} onFileClick={onFileClick} />
      )}
      {activePanel === "git" && (
        <div style={{ padding: 12 }}>
          <div style={{ color: "#00E5A0", fontSize: "0.78rem", fontFamily: "'JetBrains Mono', monospace", marginBottom: 8 }}>
            ⎇ main
          </div>
          <div style={{ color: "#2A3555", fontSize: "0.78rem", fontFamily: "'DM Sans', sans-serif" }}>
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
  terminalOpen?: boolean;
  onTerminalToggle?: () => void;
}

const TopBar = ({ voiceOpen, onVoiceToggle, terminalOpen, onTerminalToggle }: TopBarProps): React.ReactElement => (
  <div style={{
    height: 48, background: "#080B12",
    borderBottom: "1px solid #1A2033",
    display: "flex", alignItems: "center",
    padding: "0 12px", gap: 12, flexShrink: 0,
  }}>
    {/* Logo */}
    <div style={{ display: "flex", alignItems: "center", height: "100%", paddingLeft: 4, paddingRight: 8 }}>
      <img
        src="/logo3.png"
        alt="Señorita"
        style={{ width: 120, height: "auto", objectFit: "contain", flexShrink: 0, display: "block", mixBlendMode: "screen" }}
      />
    </div>

    {/* Menu items */}
    {["File", "Edit", "View", "Go", "Run", "Terminal", "Help"].map((item) => (
      <span
        key={item}
        onClick={() => { if (item === "Terminal") onTerminalToggle?.(); }}
        style={{
          fontFamily: "'Inter', 'DM Sans', sans-serif",
          fontSize: "0.88rem",
          fontWeight: 600,
          color: item === "Terminal" && terminalOpen ? "#00D4E8" : "#8A9BB8",
          cursor: "pointer",
          padding: "4px 8px",
          borderRadius: 3,
          letterSpacing: "0.01em",
          transition: "color 0.15s, background 0.15s",
        }}
        onMouseEnter={(e: React.MouseEvent<HTMLSpanElement>) => {
          e.currentTarget.style.color = "#F0F4FF";
          e.currentTarget.style.background = "#1A2033";
        }}
        onMouseLeave={(e: React.MouseEvent<HTMLSpanElement>) => {
          e.currentTarget.style.color = item === "Terminal" && terminalOpen ? "#00D4E8" : "#8A9BB8";
          e.currentTarget.style.background = "transparent";
        }}
      >
        {item}
      </span>
    ))}

    <div style={{ flex: 1 }} />

    {/* Right side */}
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      {/* Voice toggle button */}
      <button
        onClick={onVoiceToggle}
        title="Toggle Voice Panel (Ctrl+Shift+V)"
        style={{
          display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
          height: 32, padding: "0 12px",
          background: voiceOpen ? "rgba(0,212,232,0.12)" : "transparent",
          border: `1px solid ${voiceOpen ? "rgba(0,212,232,0.4)" : "#1A2033"}`,
          borderRadius: 6,
          color: voiceOpen ? "#00D4E8" : "#5A6888",
          cursor: "pointer", transition: "all 0.2s",
          fontSize: "0.82rem", fontFamily: "'DM Sans', sans-serif",
        }}
        onMouseEnter={e => {
          if (!voiceOpen) {
            e.currentTarget.style.color = "#00D4E8";
            e.currentTarget.style.borderColor = "rgba(0,212,232,0.3)";
            e.currentTarget.style.background = "rgba(0,212,232,0.05)";
          }
        }}
        onMouseLeave={e => {
          if (!voiceOpen) {
            e.currentTarget.style.color = "#5A6888";
            e.currentTarget.style.borderColor = "#1A2033";
            e.currentTarget.style.background = "transparent";
          }
        }}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"
          stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
          <rect x="4.5" y="1" width="5" height="7.5" rx="2.5" />
          <path d="M2 7a5 5 0 0 0 10 0" />
          <line x1="7" y1="12" x2="7" y2="13.5" />
          <line x1="5" y1="13.5" x2="9" y2="13.5" />
        </svg>
        <span>Voice</span>
      </button>

      {/* Settings button */}
      <button
        title="Settings"
        style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          width: 32, height: 32,
          background: "transparent",
          border: "1px solid #1A2033",
          borderRadius: 6,
          color: "#5A6888",
          cursor: "pointer", transition: "all 0.2s",
          fontSize: "0.9rem",
        }}
        onMouseEnter={e => {
          e.currentTarget.style.color = "#00D4E8";
          e.currentTarget.style.borderColor = "rgba(0,212,232,0.3)";
          e.currentTarget.style.background = "rgba(0,212,232,0.05)";
        }}
        onMouseLeave={e => {
          e.currentTarget.style.color = "#5A6888";
          e.currentTarget.style.borderColor = "#1A2033";
          e.currentTarget.style.background = "transparent";
        }}
      >
        ⚙
      </button>
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
    <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "0.85rem", color: "#2A3555", textAlign: "center", maxWidth: 220 }}>
      Select a file from the explorer<br />or press <kbd style={{ background: "#1A2033", padding: "1px 5px", borderRadius: 3, fontFamily: "'JetBrains Mono', monospace", fontSize: "0.78rem", color: "#4DD9E8" }}>⌘K</kbd> to open
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

    @keyframes vpSpin {
      from { transform: rotate(0deg); }
      to   { transform: rotate(360deg); }
    }

    @keyframes vpWaveBar {
      0%,100% { transform: scaleY(0.2); }
      50%     { transform: scaleY(1); }
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
   TERMINAL PANEL
   ============================================================ */
interface TerminalLine {
  type: "input" | "output" | "error" | "info";
  text: string;
}

const SIMULATED_COMMANDS: Record<string, string[]> = {
  "ls": ["src/  node_modules/  public/  package.json  tsconfig.json  next.config.ts  README.md"],
  "ls -la": ["total 48", "drwxr-xr-x  8 user staff   256 Feb 28 04:00 .", "drwxr-xr-x  3 user staff    96 Feb 28 03:00 ..", "-rw-r--r--  1 user staff  1234 Feb 28 04:00 package.json", "-rw-r--r--  1 user staff   512 Feb 28 03:00 tsconfig.json", "drwxr-xr-x 12 user staff   384 Feb 28 04:00 src", "drwxr-xr-x  4 user staff   128 Feb 28 04:00 public"],
  "pwd": ["/Users/user/Senorita_Voice_IDE/frontend/my-next-app"],
  "node --version": ["v20.11.0"],
  "npm --version": ["10.2.4"],
  "git status": ["On branch main\nYour branch is up to date with 'origin/main'.\n\nChanges not staged for commit:\n  modified:   src/app/editor/page.tsx\n  modified:   src/components/VoicePanel.tsx"],
  "git log --oneline -5": ["49254d6 Loding animation changed", "78670fc feat: add wake word detection", "3a9d1f2 fix: resolve port conflicts", "d12e45a feat: add dashboard button", "8bc3a10 initial commit"],
  "npm run dev": ["▲ Next.js 16.1.6 (Turbopack)", "  ✓ Starting...", "  ✓ Ready in 389ms", "  - Local:   http://localhost:3000"],
  "npm run build": ["▲ Next.js 16.1.6", "  Creating an optimized production build...", "  ✓ Compiled successfully", "  ✓ Linting and checking validity of types", "  Route (app)  Size  First Load JS", "  ┌ ○ /         142 kB  248 kB", "  └ ○ /editor   890 kB  996 kB"],
  "cat package.json": ['{\n  "name": "my-next-app",\n  "version": "0.1.0",\n  "private": true,\n  "scripts": {\n    "dev": "next dev",\n    "build": "next build",\n    "start": "next start"\n  }\n}'],
  "whoami": ["user"],
  "date": [new Date().toString()],
  "echo $PATH": ["/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"],
  "clear": ["__CLEAR__"],
  "help": ["Available commands: ls, pwd, git, npm, node, cat, echo, whoami, date, clear, help"],
};

function TerminalPanel({ height, onHeightChange }: { height: number; onHeightChange: (h: number) => void }): React.ReactElement {
  const [lines, setLines] = useState<TerminalLine[]>([
    { type: "info", text: "Senorita Terminal  —  bash  (zsh compatible)" },
    { type: "info", text: 'Type "help" for available commands.' },
  ]);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [cwd] = useState("~/Senorita_Voice_IDE/frontend/my-next-app");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const isDragging = useRef(false);
  const dragStartY = useRef(0);
  const dragStartH = useRef(0);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [lines]);

  const handleDragMouseDown = (e: React.MouseEvent) => {
    isDragging.current = true;
    dragStartY.current = e.clientY;
    dragStartH.current = height;
    e.preventDefault();
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = dragStartY.current - e.clientY;
      onHeightChange(Math.max(80, Math.min(600, dragStartH.current + delta)));
    };
    const onUp = () => { isDragging.current = false; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [onHeightChange]);

  const runCommand = (cmd: string) => {
    const trimmed = cmd.trim();
    if (!trimmed) return;
    setLines(prev => [...prev, { type: "input", text: trimmed }]);
    setHistory(prev => [trimmed, ...prev]);
    setHistoryIdx(-1);

    const key = Object.keys(SIMULATED_COMMANDS).find(k => trimmed === k || trimmed.startsWith(k + " "));
    if (key) {
      const outputs = SIMULATED_COMMANDS[key];
      if (outputs[0] === "__CLEAR__") { setLines([]); return; }
      outputs.forEach(line => {
        line.split("\n").forEach(l => setLines(prev => [...prev, { type: "output", text: l }]));
      });
    } else if (trimmed.startsWith("echo ")) {
      setLines(prev => [...prev, { type: "output", text: trimmed.slice(5).replace(/^["']|["']$/g, "") }]);
    } else if (trimmed.startsWith("cd ")) {
      setLines(prev => [...prev, { type: "output", text: "" }]);
    } else {
      setLines(prev => [...prev, { type: "error", text: `zsh: command not found: ${trimmed.split(" ")[0]}` }]);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") { runCommand(input); setInput(""); }
    else if (e.key === "ArrowUp") {
      e.preventDefault();
      const idx = Math.min(historyIdx + 1, history.length - 1);
      setHistoryIdx(idx);
      setInput(history[idx] ?? "");
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const idx = Math.max(historyIdx - 1, -1);
      setHistoryIdx(idx);
      setInput(idx === -1 ? "" : history[idx] ?? "");
    } else if (e.key === "l" && e.ctrlKey) {
      e.preventDefault(); setLines([]);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height, background: "#080B12", borderTop: "1px solid #1A2033", flexShrink: 0 }}>
      {/* Drag handle */}
      <div
        onMouseDown={handleDragMouseDown}
        style={{ height: 4, cursor: "row-resize", background: "transparent", flexShrink: 0, transition: "background 0.15s" }}
        onMouseEnter={e => (e.currentTarget.style.background = "rgba(0,212,232,0.4)")}
        onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
      />
      {/* Title bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 12px", height: 28, background: "#060810", borderBottom: "1px solid #1A2033", flexShrink: 0 }}>
        <span style={{ fontSize: "0.7rem", fontFamily: "'JetBrains Mono', monospace", color: "#00D4E8", letterSpacing: "0.08em", textTransform: "uppercase" }}>TERMINAL</span>
        <span style={{ fontSize: "0.7rem", fontFamily: "'JetBrains Mono', monospace", color: "#2A3555" }}>bash</span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: "0.78rem", color: "#2A3555", cursor: "pointer", padding: "2px 4px" }}
          onMouseEnter={e => (e.currentTarget.style.color = "#C8D5E8")}
          onMouseLeave={e => (e.currentTarget.style.color = "#2A3555")}
          onClick={() => setLines([])} title="Clear">⌫</span>
      </div>
      {/* Output area */}
      <div
        onClick={() => inputRef.current?.focus()}
        style={{ flex: 1, overflowY: "auto", padding: "8px 12px", fontFamily: "'JetBrains Mono', monospace", fontSize: "0.85rem", lineHeight: 1.6, cursor: "text" }}
      >
        {lines.map((l, i) => (
          <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 0 }}>
            {l.type === "input" && (
              <span style={{ color: "#00D4E8", whiteSpace: "pre" }}>
                <span style={{ color: "#00E5A0" }}>➜ </span>
                <span style={{ color: "#8A9BB8" }}>{cwd} </span>
                <span style={{ color: "#EEF4FF" }}>{l.text}</span>
              </span>
            )}
            {l.type === "output" && <span style={{ color: "#C8D5E8", whiteSpace: "pre" }}>{l.text}</span>}
            {l.type === "error" && <span style={{ color: "#FF4D6D", whiteSpace: "pre" }}>{l.text}</span>}
            {l.type === "info" && <span style={{ color: "#3A4560", whiteSpace: "pre" }}>{l.text}</span>}
          </div>
        ))}
        {/* Active prompt line */}
        <div style={{ display: "flex", alignItems: "center" }}>
          <span style={{ color: "#00E5A0", whiteSpace: "pre" }}>➜ </span>
          <span style={{ color: "#8A9BB8", whiteSpace: "pre" }}>{cwd} </span>
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus
            spellCheck={false}
            style={{
              flex: 1, background: "transparent", border: "none", outline: "none",
              color: "#EEF4FF", fontFamily: "'JetBrains Mono', monospace", fontSize: "0.85rem",
              caretColor: "#00D4E8", padding: 0,
            }}
          />
        </div>
        <div ref={bottomRef} />
      </div>
    </div>
  );
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
  const [fileTree, setFileTree] = useState<FileNode[]>([]); // Empty = no folder open, user opens folder first
  const [folderName, setFolderName] = useState<string>("");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [rootHandle, setRootHandle] = useState<any>(null);
  const [isLoadingFolder, setIsLoadingFolder] = useState<boolean>(false);

  /* ---- Voice panel state (right-side panel) ---- */
  const [voiceOpen, setVoiceOpen]           = useState<boolean>(false);
  const [voicePanelW, setVoicePanelW]       = useState<number>(300);
  const [lastTranscript, setLastTranscript] = useState<string>("");
  const [activeMode, setActiveMode]         = useState<AIMode>("Ask");
  const injectCodeRef = useRef<((code: string) => void) | null>(null);
  const [terminalOpen, setTerminalOpen] = useState<boolean>(false);
  const [terminalHeight, setTerminalHeight] = useState<number>(220);

  const handleSendToChat = useCallback((code: string) => {
    setVoiceOpen(true);
    // Give VoicePanel a tick to mount before injecting
    setTimeout(() => { injectCodeRef.current?.(code); }, 80);
  }, []);

  /* ---- Summary panel state ---- */
  const [summaryData, setSummaryData]       = useState<ConversationSummaryData | null>(null);
  const [summaryOpen, setSummaryOpen]       = useState<boolean>(false);
  const [summaryLoading, setSummaryLoading] = useState<boolean>(false);
  const isVoiceResizing    = useRef<boolean>(false);
  const voiceResizeStartX  = useRef<number>(0);
  const voiceResizeStartW  = useRef<number>(300);

  const isResizing = useRef<boolean>(false);
  const startX = useRef<number>(0);
  const startWidth = useRef<number>(220);

  /* ----------------------------------------------------------------
     Summary handler — called by VoicePanel's Summarize button
     ---------------------------------------------------------------- */
  const handleSummarize = useCallback(async (messages: ChatMessage[], codeChanges: CodeChange[]) => {
    setSummaryLoading(true);
    setSummaryOpen(true);
    setSummaryData(null);
    try {
      const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
      const res = await fetch(`${API_BASE}/api/summarize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: messages.map(m => ({ role: m.role, text: m.text, intent: m.intent ?? null })),
          code_changes: codeChanges.map(c => ({ heading: c.heading, description: c.description, action: c.action, filename: c.filename })),
          filename: activeTabId ? (tabs.find(t => t.id === activeTabId)?.name ?? null) : null,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.ok && data.summary) {
        setSummaryData(data.summary as ConversationSummaryData);
      }
    } catch (err) {
      console.error("[EditorPage] Summarize error:", err);
      setSummaryData(null);
      setSummaryOpen(false);
    } finally {
      setSummaryLoading(false);
    }
  }, [activeTabId, tabs]);

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

  /* ---- Auto-open files when they are referenced ---- */
  useEffect(() => {
    const handleOpenFiles = async (e: Event) => {
      const customEvent = e as CustomEvent<{ files: Array<{ filename: string; path: string }> }>;
      const filesToOpen = customEvent.detail?.files || [];
      
      for (const file of filesToOpen) {
        if (!file.filename && !file.path) continue;
        
        const filename = file.filename || file.path.split(/[/\\]/).pop() || "";
        console.log(`[EditorPage] Attempting to open: ${filename} (path: ${file.path})`);
        
        // Check if already open by name or path
        const existingTab = tabs.find(t => 
          t.name === filename || 
          t.id === file.path ||
          t.name.toLowerCase() === filename.toLowerCase() ||
          file.path.toLowerCase().includes(t.name.toLowerCase())
        );
        
        if (existingTab) {
          console.log(`[EditorPage] File already open: ${existingTab.name}`);
          setActiveTabId(existingTab.id);
          continue;
        }
        
        // Try to fetch from registry - try path first, then filename
        let registryFile = await getFileFromRegistry(file.path);
        if (!registryFile && filename) {
          console.log(`[EditorPage] Path lookup failed, trying filename: ${filename}`);
          registryFile = await getFileFromRegistry(filename);
        }
        
        if (registryFile && registryFile.content) {
          const newTab: Tab = {
            id: registryFile.path || file.path,
            name: registryFile.filename || filename,
            language: getLanguage(registryFile.filename || filename),
            content: registryFile.content,
            isDirty: false,
          };
          setTabs(prev => {
            // Double-check not already added
            if (prev.some(t => t.name === newTab.name)) return prev;
            return [...prev, newTab];
          });
          setActiveTabId(newTab.id);
          console.log(`[EditorPage] Auto-opened ${newTab.name} (${registryFile.content.length} chars)`);
        } else {
          console.warn(`[EditorPage] Could not find file in registry: ${filename}`);
        }
      }
    };
    
    window.addEventListener("senorita:open-files", handleOpenFiles);
    return () => window.removeEventListener("senorita:open-files", handleOpenFiles);
  }, [tabs]);

  /* ---- Build editor context for VoicePanel ---- */
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;
  const editorContext: EditorContext = {
    language: activeTab?.language ?? "plaintext",
    filename: activeTab?.name ?? "untitled",
    currentCode: activeTab?.content ?? "",
    cursorLine: cursorPos.line,
    selection: selection,
    projectRoot: folderName || undefined,  // Pass project folder name for symbol indexing
  };

  // Open file - reads content from handle if available
  const handleFileOpen = useCallback(async (node: FileNode): Promise<void> => {
    if (node.type !== "file") return;

    setActiveFileId(node.id);

    // If already open, just activate — but re-read if content was empty
    const existing = tabs.find((t) => t.id === node.id);
    if (existing) {
      setActiveTabId(node.id);
      if (existing.content === "" && node.handle) {
        try {
          const fresh = await readFileContent(node.handle);
          if (fresh) {
            setTabs(prev => prev.map(t => t.id === node.id ? { ...t, content: fresh } : t));
            registerFile(node.name, node.id, fresh, existing.language);
          }
        } catch { /* silent */ }
      }
      return;
    }

    // Read content from file handle if available (dynamic folder)
    let content = node.content || "";
    if (node.handle) {
      try {
        console.log(`[handleFileOpen] Reading file: ${node.name}, handle exists: ${!!node.handle}`);
        const read = await readFileContent(node.handle);
        console.log(`[handleFileOpen] Read ${node.name}: ${read.length} chars`);
        if (read) content = read;
      } catch (err) {
        console.warn(`[handleFileOpen] Error reading file ${node.name}:`, err);
        content = "// Could not read file — try closing and re-opening the folder";
      }
    } else {
      console.log(`[handleFileOpen] No handle for ${node.name}, using node.content: ${(node.content || "").length} chars`);
    }

    const lang = node.language || getLanguage(node.name);
    const newTab: Tab = {
      id: node.id,
      name: node.name,
      language: lang,
      content,
      isDirty: false,
    };

    setTabs((prev) => {
      const next = [...prev, newTab];
      // Update workspace store with new tab list + active file
      import("../../store/workspaceStore").then(({ loadWorkspace, saveWorkspace }) => {
        const ws = loadWorkspace();
        if (ws) {
          saveWorkspace({
            ...ws,
            activeFile: { name: newTab.name, path: newTab.id, language: lang },
            openTabs: next.map(t => ({ name: t.name, path: t.id, language: t.language })),
            updatedAt: Date.now(),
          });
        }
      });
      return next;
    });
    setActiveTabId(node.id);
    setShowMarkdown(false);
    registerFile(node.name, node.id, content, lang);
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
      
      // Register all files with backend for context sharing
      // Clear previous registry first
      await clearFileRegistry();
      
      // Collect all files from tree and read their content
      const collectAndReadFiles = async (nodes: FileNode[], parentPath: string = ""): Promise<Array<{ filename: string; path: string; content: string; language: string }>> => {
        const files: Array<{ filename: string; path: string; content: string; language: string }> = [];
        
        for (const node of nodes) {
          const nodePath = parentPath ? `${parentPath}/${node.name}` : node.name;
          
          if (node.type === "file") {
            // Read file content
            let content = node.content || "";
            if (node.handle && !node.content) {
              try {
                content = await readFileContent(node.handle);
              } catch (err) {
                console.warn(`[handleOpenFolder] Failed to read ${node.name}:`, err);
                content = "";
              }
            }
            
            // Only register if we have content and it's not too large (< 100KB)
            if (content && content.length < 100000) {
              files.push({
                filename: node.name,
                path: nodePath,
                content,
                language: node.language || getLanguage(node.name),
              });
            }
          } else if (node.children) {
            // Recurse into folders
            const childFiles = await collectAndReadFiles(node.children, nodePath);
            files.push(...childFiles);
          }
        }
        
        return files;
      };
      
      // Collect and register files in background
      collectAndReadFiles(tree as unknown as FileNode[]).then(async (files) => {
        if (files.length > 0) {
          console.log(`[handleOpenFolder] Registering ${files.length} files with backend...`);
          await registerFilesBatch(files);
          console.log(`[handleOpenFolder] Registered ${files.length} files`);
        }
        // Persist workspace context so Copilot page can read it
        saveWorkspace({
          folderName: handle.name,
          folderPath: handle.name,
          files: files.map(f => ({ name: f.filename, path: f.path, language: f.language })),
          activeFile: null,
          openTabs: [],
          updatedAt: Date.now(),
        });
      });
      
    } catch (err) {
      console.error("Error opening folder:", err);
    } finally {
      setIsLoadingFolder(false);
    }
  }, []);

  const handleTabClose = (id: string): void => {
    // Unregister file from backend when tab is closed
    unregisterFile(id);
    
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

    // Track in activity store
    const linesChanged = Math.abs(
      newContent.split("\n").length - activeTab.content.split("\n").length
    );
    pushActivity({
      type: "accept",
      timestamp: Date.now(),
      filename: activeTab.name,
      project: folderName || "Virtual workspace",
      description: pendingAction.explanation
        ? pendingAction.explanation.slice(0, 80)
        : `${pendingAction.action.replace("_", " ")} in ${activeTab.name}`,
      action: pendingAction.action,
      linesChanged,
    });
    
    setTabs(prev => prev.map(tab => {
      if (tab.id !== activeTabId) return tab;
      return { ...tab, content: newContent, isDirty: true };
    }));
    setPendingAction(null);
  }, [pendingAction, activeTab, activeTabId, cursorPos.line, folderName]);

  // Handle rejecting pending code action
  const handleRejectAction = useCallback((): void => {
    if (pendingAction && activeTab) {
      pushActivity({
        type: "reject",
        timestamp: Date.now(),
        filename: activeTab.name,
        project: folderName || "Virtual workspace",
        description: pendingAction.explanation
          ? pendingAction.explanation.slice(0, 80)
          : `Rejected ${pendingAction.action.replace("_", " ")} in ${activeTab.name}`,
        action: pendingAction.action,
      });
    }
    setPendingAction(null);
  }, [pendingAction, activeTab, folderName]);

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
        <TopBar voiceOpen={voiceOpen} onVoiceToggle={() => setVoiceOpen(v => !v)} terminalOpen={terminalOpen} onTerminalToggle={() => setTerminalOpen(v => !v)} />

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
                      fontSize: "0.78rem", fontFamily: "'DM Sans', sans-serif",
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
                    onSendToChat={handleSendToChat}
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
                    <span style={{ fontSize: "0.7rem", fontFamily: "'JetBrains Mono', monospace", color: "#2A3555", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                      Markdown Preview
                    </span>
                    <span
                      onClick={() => setShowMarkdown(false)}
                      style={{ color: "#2A3555", fontSize: "0.78rem", cursor: "pointer", transition: "color 0.15s" }}
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

            {/* ── Terminal panel (bottom, VS Code style) ── */}
            {terminalOpen && (
              <TerminalPanel
                height={terminalHeight}
                onHeightChange={setTerminalHeight}
              />
            )}

            {/* Bottom drag-up handle to open terminal (always visible when closed) */}
            {!terminalOpen && (
              <div
                onMouseDown={(e) => {
                  // Start drag — if user drags up, open terminal
                  const startY = e.clientY;
                  const onMove = (mv: MouseEvent) => {
                    if (startY - mv.clientY > 10) {
                      setTerminalOpen(true);
                      window.removeEventListener("mousemove", onMove);
                      window.removeEventListener("mouseup", onUp);
                    }
                  };
                  const onUp = () => {
                    window.removeEventListener("mousemove", onMove);
                    window.removeEventListener("mouseup", onUp);
                  };
                  window.addEventListener("mousemove", onMove);
                  window.addEventListener("mouseup", onUp);
                  e.preventDefault();
                }}
                title="Drag up to open terminal"
                style={{ height: 5, cursor: "row-resize", flexShrink: 0, background: "transparent", borderTop: "1px solid #1A2033", transition: "background 0.15s" }}
                onMouseEnter={e => (e.currentTarget.style.background = "rgba(0,212,232,0.3)")}
                onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
              />
            )}
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
                  onSummarize={handleSummarize}
                  onModeChange={setActiveMode}
                  injectCodeRef={injectCodeRef}
                  onOpenFile={(filename) => {
                    // Find file in tabs or registry and open it
                    const existingTab = tabs.find(t => 
                      t.name === filename || 
                      t.id.endsWith(filename) ||
                      t.name.toLowerCase() === filename.toLowerCase()
                    );
                    
                    if (existingTab) {
                      setActiveTabId(existingTab.id);
                    } else {
                      // Try to find in registry
                      getFileFromRegistry(filename).then((registryFile) => {
                        if (registryFile) {
                          const newTab: Tab = {
                            id: registryFile.path,
                            name: registryFile.filename,
                            language: getLanguage(registryFile.filename),
                            content: registryFile.content,
                            isDirty: false,
                          };
                          setTabs(prev => [...prev, newTab]);
                          setActiveTabId(registryFile.path);
                        }
                      });
                    }
                  }}
                  onCodeAction={(action) => {
                    // Handle multi-file edits - apply pending edit to each target file
                    if (action.edits && action.edits.length > 0) {
                      action.edits.forEach((edit) => {
                        const targetPath = edit.file_path;
                        const pendingEdit: PendingFileEdit = {
                          action: edit.action,
                          code: edit.code,
                          insert_at_line: edit.insert_at_line,
                          start_line: edit.start_line,
                          end_line: edit.end_line,
                          explanation: action.explanation,
                          file_path: targetPath,
                        };
                        
                        // Find existing tab by matching file path/name
                        const existingTab = tabs.find(t => 
                          t.id === targetPath || 
                          t.name === targetPath.split('/').pop() ||
                          targetPath.includes(t.name)
                        );
                        
                        if (existingTab) {
                          // Update existing tab with pending edit
                          setTabs(prev => prev.map(tab => 
                            tab.id === existingTab.id 
                              ? { ...tab, pendingEdit } 
                              : tab
                          ));
                          setActiveTabId(existingTab.id);
                        } else {
                          // File not open - fetch from registry
                          const fileName = targetPath.split('/').pop() || targetPath;
                          getFileFromRegistry(targetPath).then((registryFile) => {
                            const fileContent = registryFile 
                              ? registryFile.content 
                              : `// File: ${targetPath}\n// Not found in registry.`;
                            const newTab: Tab = {
                              id: targetPath,
                              name: fileName,
                              language: getLanguage(fileName),
                              content: fileContent,
                              isDirty: false,
                              pendingEdit,
                            };
                            setTabs(prev => [...prev, newTab]);
                            setActiveTabId(targetPath);
                          });
                        }
                      });
                      
                      // Also set the legacy pendingAction for the first edit
                      const firstEdit = action.edits[0];
                      setPendingAction({
                        action: firstEdit.action,
                        code: firstEdit.code,
                        insert_at_line: firstEdit.insert_at_line,
                        start_line: firstEdit.start_line,
                        end_line: firstEdit.end_line,
                        explanation: action.explanation,
                      });
                    }
                  }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Status bar */}
        <StatusBar activeTab={activeTab} fileCount={totalFiles} cursorPos={cursorPos} />

        {/* ── Summary Overlay Panel ── */}
        {summaryOpen && (
          <div style={{
            position: "fixed", inset: 0, zIndex: 500,
            background: "rgba(7,9,14,0.75)",
            backdropFilter: "blur(6px)",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: "24px",
            animation: "editorFadeIn 0.2s ease forwards",
          }}
            onClick={e => { if (e.target === e.currentTarget) setSummaryOpen(false); }}
          >
            <div style={{
              width: "min(820px, 100%)",
              height: "min(88vh, 860px)",
              background: "#08090F",
              border: "1px solid #1A2033",
              borderRadius: 16,
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              boxShadow: "0 32px 100px rgba(0,0,0,0.7), 0 0 0 1px rgba(139,92,246,0.15)",
            }}>
              {/* Summary tab header */}
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "0 16px", height: 42, flexShrink: 0,
                background: "#060810", borderBottom: "1px solid #1A2033",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{
                    width: 20, height: 20, borderRadius: 5,
                    background: "linear-gradient(135deg, #8B5CF6, #6D28D9)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    boxShadow: "0 0 8px rgba(139,92,246,0.4)",
                    fontSize: "0.68rem", flexShrink: 0,
                  }}>✦</div>
                  <span style={{
                    fontSize: "0.78rem", fontFamily: "'DM Sans', sans-serif",
                    color: summaryLoading ? "#5A6888" : "#C8D5E8", fontWeight: 500,
                  }}>
                    {summaryLoading ? "Analyzing conversation…" : (summaryData?.title ?? "Session Summary")}
                  </span>
                  {summaryLoading && (
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
                      style={{ animation: "vpSpin 0.8s linear infinite", flexShrink: 0 }}>
                      <circle cx="6" cy="6" r="4.5" stroke="#8B5CF6" strokeWidth="1.5" strokeDasharray="16 10" />
                    </svg>
                  )}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {/* Export button */}
                  {summaryData && !summaryLoading && (
                    <button
                      onClick={() => {
                        if (!summaryData) return;
                        let md = `# ${summaryData.title}\n\n`;
                        md += `${summaryData.overview}\n\n`;
                        md += `## Session Stats\n\n`;
                        md += `| Metric | Value |\n|--------|-------|\n`;
                        md += `| Total Messages | ${summaryData.stats.total_messages} |\n`;
                        md += `| User Messages | ${summaryData.stats.user_messages} |\n`;
                        md += `| AI Replies | ${summaryData.stats.ai_messages} |\n`;
                        md += `| Code Blocks | ${summaryData.stats.code_blocks} |\n\n`;
                        if (summaryData.intent_breakdown.length > 0) {
                          md += `## Intent Breakdown\n\n`;
                          summaryData.intent_breakdown.forEach(ib => {
                            md += `- **${ib.intent.toUpperCase()}** (${ib.count}): ${ib.description}\n`;
                          });
                          md += `\n`;
                        }
                        if (summaryData.key_actions.length > 0) {
                          md += `## Key Actions\n\n`;
                          summaryData.key_actions.forEach((ka, i) => {
                            md += `${i + 1}. **${ka.action}** - ${ka.detail}\n`;
                          });
                          md += `\n`;
                        }
                        if (summaryData.code_changes && summaryData.code_changes.length > 0) {
                          md += `## Code Changes\n\n`;
                          summaryData.code_changes.forEach(cc => {
                            md += `- **${cc.heading}** (${cc.filename}): ${cc.description}\n`;
                          });
                          md += `\n`;
                        }
                        if (summaryData.insights.length > 0) {
                          md += `## Insights\n\n`;
                          summaryData.insights.forEach(ins => {
                            md += `### ${ins.icon} ${ins.title}\n\n${ins.body}\n\n`;
                          });
                        }
                        if (summaryData.flowchart) {
                          md += `## Conversation Flow\n\n\`\`\`mermaid\n${summaryData.flowchart}\n\`\`\`\n`;
                        }
                        md += `\n---\n*Generated by Senorita AI on ${new Date().toLocaleString()}*\n`;
                        const blob = new Blob([md], { type: "text/markdown" });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = `senorita-summary-${Date.now()}.md`;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        URL.revokeObjectURL(url);
                      }}
                      style={{
                        background: "rgba(139,92,246,0.1)",
                        border: "1px solid rgba(139,92,246,0.3)",
                        color: "#8B5CF6",
                        borderRadius: 5,
                        padding: "3px 8px",
                        cursor: "pointer",
                        fontSize: "0.75rem",
                        fontFamily: "'JetBrains Mono', monospace",
                        transition: "all 0.15s",
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.color = "#A78BFA";
                        e.currentTarget.style.borderColor = "rgba(139,92,246,0.5)";
                        e.currentTarget.style.background = "rgba(139,92,246,0.15)";
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.color = "#8B5CF6";
                        e.currentTarget.style.borderColor = "rgba(139,92,246,0.3)";
                        e.currentTarget.style.background = "rgba(139,92,246,0.1)";
                      }}
                    >
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 12 12"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                      >
                        <path d="M6 1v8M3 6l3 3 3-3" />
                        <path d="M1 10h10" />
                      </svg>
                      export .md
                    </button>
                  )}
                  {/* Close button */}
                  <button
                    onClick={() => setSummaryOpen(false)}
                    style={{
                      background: "transparent",
                      border: "1px solid #1A2033",
                      color: "#3A4560",
                      borderRadius: 5,
                      padding: "3px 8px",
                      cursor: "pointer",
                      fontSize: "0.75rem",
                      fontFamily: "'JetBrains Mono', monospace",
                      transition: "all 0.15s",
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.color = "#C8D5E8";
                      e.currentTarget.style.borderColor = "#2A3555";
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.color = "#3A4560";
                      e.currentTarget.style.borderColor = "#1A2033";
                    }}
                  >
                    close
                  </button>
                </div>
              </div>

              {/* Summary body */}
              <div style={{ flex: 1, overflow: "hidden" }}>
                {summaryLoading && (
                  <div
                    style={{
                      height: "100%",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 20,
                      background: "#08090F",
                    }}
                  >
                    {/* Animated orb */}
                    <div style={{ position: "relative" }}>
                      <div
                        style={{
                          width: 64,
                          height: 64,
                          borderRadius: "50%",
                          background:
                            "linear-gradient(135deg, rgba(139,92,246,0.3), rgba(109,40,217,0.15))",
                          border: "1px solid rgba(139,92,246,0.3)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          boxShadow: "0 0 40px rgba(139,92,246,0.2)",
                        }}
                      >
                        <svg
                          width="28"
                          height="28"
                          viewBox="0 0 28 28"
                          fill="none"
                          style={{ animation: "vpSpin 2s linear infinite" }}
                        >
                          <circle
                            cx="14"
                            cy="14"
                            r="11"
                            stroke="rgba(139,92,246,0.6)"
                            strokeWidth="1.5"
                            strokeDasharray="40 28"
                          />
                          <circle
                            cx="14"
                            cy="14"
                            r="6"
                            stroke="rgba(139,92,246,0.3)"
                            strokeWidth="1"
                            strokeDasharray="18 12"
                          />
                        </svg>
                      </div>
                    </div>
                    <div style={{ textAlign: "center" }}>
                      <div
                        style={{
                          fontFamily: "'Syne', sans-serif",
                          fontSize: "0.9rem",
                          fontWeight: 700,
                          color: "#C8D5E8",
                          marginBottom: 6,
                        }}
                      >
                        Analyzing your session
                      </div>
                      <div
                        style={{
                          fontSize: "0.78rem",
                          color: "#3A4560",
                          fontFamily: "'DM Sans', sans-serif",
                          lineHeight: 1.6,
                        }}
                      >
                        Building flowcharts, extracting insights
                        <br />
                        and summarizing your conversation…
                      </div>
                    </div>
                    {/* Animated dots */}
                    <div style={{ display: "flex", gap: 6 }}>
                      {[0, 1, 2].map(i => (
                        <div
                          key={i}
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: "50%",
                            background: "#8B5CF6",
                            animation: `vpWaveBar 1.2s ease-in-out infinite ${i * 0.2}s`,
                            transformOrigin: "center",
                          }}
                        />
                      ))}
                    </div>
                  </div>
                )}
                {!summaryLoading && summaryData && (
                  <ConversationSummary
                    data={summaryData}
                    onClose={() => setSummaryOpen(false)}
                  />
                )}
                {!summaryLoading && !summaryData && (
                  <div
                    style={{
                      height: "100%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexDirection: "column",
                      gap: 12,
                    }}
                  >
                    <span style={{ fontSize: "2rem" }}>
                      
                    </span>
                    <span
                      style={{
                        color: "#FF4D6D",
                        fontSize: "0.8rem",
                        fontFamily: "'DM Sans', sans-serif",
                      }}
                    >
                      Failed to generate summary. Is the backend running?
                    </span>
                    <button
                      onClick={() => setSummaryOpen(false)}
                      style={{
                        background: "transparent",
                        border: "1px solid #1A2033",
                        color: "#5A6888",
                        borderRadius: 6,
                        padding: "6px 14px",
                        cursor: "pointer",
                        fontSize: "0.82rem",
                      }}
                    >
                      Close
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

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
            <span style={{ color: "#00D4E8", fontSize: "0.78rem", fontFamily: "'JetBrains Mono', monospace", flexShrink: 0 }}>🎙</span>
            <span style={{
              color: "#8A9BB8", fontSize: "0.78rem",
              fontFamily: "'DM Sans', sans-serif",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>{lastTranscript}</span>
            <span
              onClick={e => { e.stopPropagation(); setLastTranscript(""); }}
              style={{ color: "#3A4560", fontSize: "0.72rem", cursor: "pointer", flexShrink: 0 }}
            >✕</span>
          </div>
        )}
      </div>
    </>
  );
}