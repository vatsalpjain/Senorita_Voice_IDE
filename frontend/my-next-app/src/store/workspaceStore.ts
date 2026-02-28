/**
 * Workspace Store — persists the current editor workspace to localStorage
 * so the Copilot page can read it without any backend round-trip.
 *
 * Written by: editor/page.tsx  (on folder open / file open)
 * Read by:    copilot/page.tsx (on mount + storage event)
 */

const KEY = "senorita_workspace_v1";

export interface WorkspaceFile {
  name: string;
  path: string;
  language: string;
}

export interface WorkspaceContext {
  folderName: string;          // e.g. "my-project"
  folderPath: string;          // root path as reported by File System API
  files: WorkspaceFile[];      // flat list of all files in the folder
  activeFile: WorkspaceFile | null;
  openTabs: WorkspaceFile[];   // currently open tabs
  updatedAt: number;           // epoch ms — used to detect staleness
}

/** Save workspace context to localStorage */
export function saveWorkspace(ctx: WorkspaceContext): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(ctx));
    // Broadcast to other tabs / pages
    window.dispatchEvent(new StorageEvent("storage", { key: KEY }));
  } catch {
    // quota exceeded or SSR — silent
  }
}

/** Read workspace context from localStorage. Returns null if nothing saved. */
export function loadWorkspace(): WorkspaceContext | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw) as WorkspaceContext;
  } catch {
    return null;
  }
}

/** Clear workspace (called when editor is closed or folder is changed) */
export function clearWorkspace(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(KEY);
}

/** Subscribe to workspace changes (cross-page via storage events) */
export function onWorkspaceChange(cb: (ctx: WorkspaceContext | null) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: StorageEvent) => {
    if (e.key === KEY) cb(loadWorkspace());
  };
  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
}
