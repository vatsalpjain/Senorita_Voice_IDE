/**
 * File Registry Service — Registers files with the backend for context sharing.
 * 
 * Call registerFile() when a tab is opened or file content changes.
 * Call unregisterFile() when a tab is closed.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export interface RegisteredFile {
  filename: string;
  path: string;
  language: string;
  size: number;
}

export interface FileRegistryStats {
  total_files: number;
  total_size: number;
  filenames: string[];
}

/**
 * Register a file with the backend.
 * Call this when a tab is opened or file content changes.
 */
export async function registerFile(
  filename: string,
  path: string,
  content: string,
  language: string = ""
): Promise<{ ok: boolean; filename: string; path: string; size: number }> {
  try {
    const response = await fetch(`${API_BASE}/api/files/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename, path, content, language }),
    });
    
    if (!response.ok) {
      console.error("[FileRegistry] Failed to register file:", response.statusText);
      return { ok: false, filename, path, size: 0 };
    }
    
    const data = await response.json();
    console.log(`[FileRegistry] Registered: ${filename} (${data.size} bytes)`);
    return data;
  } catch (error) {
    console.error("[FileRegistry] Error registering file:", error);
    return { ok: false, filename, path, size: 0 };
  }
}

/**
 * Unregister a file from the backend.
 * Call this when a tab is closed.
 */
export async function unregisterFile(path: string): Promise<{ ok: boolean }> {
  try {
    const response = await fetch(`${API_BASE}/api/files/unregister`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
    
    if (!response.ok) {
      console.error("[FileRegistry] Failed to unregister file:", response.statusText);
      return { ok: false };
    }
    
    const data = await response.json();
    console.log(`[FileRegistry] Unregistered: ${path}`);
    return data;
  } catch (error) {
    console.error("[FileRegistry] Error unregistering file:", error);
    return { ok: false };
  }
}

/**
 * Get list of all registered files.
 */
export async function listRegisteredFiles(): Promise<RegisteredFile[]> {
  try {
    const response = await fetch(`${API_BASE}/api/files/list`);
    
    if (!response.ok) {
      console.error("[FileRegistry] Failed to list files:", response.statusText);
      return [];
    }
    
    const data = await response.json();
    return data.files || [];
  } catch (error) {
    console.error("[FileRegistry] Error listing files:", error);
    return [];
  }
}

/**
 * Get file registry statistics.
 */
export async function getFileRegistryStats(): Promise<FileRegistryStats | null> {
  try {
    const response = await fetch(`${API_BASE}/api/files/stats`);
    
    if (!response.ok) {
      return null;
    }
    
    const data = await response.json();
    return {
      total_files: data.total_files,
      total_size: data.total_size,
      filenames: data.filenames,
    };
  } catch (error) {
    console.error("[FileRegistry] Error getting stats:", error);
    return null;
  }
}

/**
 * Clear all registered files from the backend.
 */
export async function clearFileRegistry(): Promise<{ ok: boolean }> {
  try {
    const response = await fetch(`${API_BASE}/api/files/clear`, {
      method: "POST",
    });
    
    if (!response.ok) {
      return { ok: false };
    }
    
    console.log("[FileRegistry] Cleared all files");
    return { ok: true };
  } catch (error) {
    console.error("[FileRegistry] Error clearing registry:", error);
    return { ok: false };
  }
}

/**
 * Register multiple files in batch.
 * More efficient than calling registerFile() multiple times.
 */
export async function registerFilesBatch(
  files: Array<{ filename: string; path: string; content: string; language?: string }>
): Promise<{ ok: boolean; count: number }> {
  try {
    const response = await fetch(`${API_BASE}/api/files/register-batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files }),
    });
    
    if (!response.ok) {
      console.error("[FileRegistry] Failed to register batch:", response.statusText);
      return { ok: false, count: 0 };
    }
    
    const data = await response.json();
    console.log(`[FileRegistry] Registered batch: ${data.count} files`);
    return data;
  } catch (error) {
    console.error("[FileRegistry] Error registering batch:", error);
    return { ok: false, count: 0 };
  }
}
