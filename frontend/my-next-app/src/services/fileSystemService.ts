/**
 * File System Service — Uses File System Access API to open real folders
 * Like VS Code's "Open Folder" functionality
 */

export interface FileNode {
  id: string;
  name: string;
  type: "file" | "folder";
  language?: string;
  content?: string;
  children?: FileNode[];
  isOpen?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handle?: any;
  path: string;
}

// Language detection by file extension
const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  py: "python",
  rs: "rust",
  go: "go",
  java: "java",
  c: "c",
  cpp: "cpp",
  h: "c",
  hpp: "cpp",
  css: "css",
  scss: "scss",
  less: "less",
  html: "html",
  json: "json",
  md: "markdown",
  yaml: "yaml",
  yml: "yaml",
  xml: "xml",
  sql: "sql",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  dockerfile: "dockerfile",
  gitignore: "plaintext",
  env: "plaintext",
  txt: "plaintext",
};

export function getLanguageFromFilename(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  return EXTENSION_LANGUAGE_MAP[ext] || "plaintext";
}

// Check if File System Access API is supported
export function isFileSystemAccessSupported(): boolean {
  return "showDirectoryPicker" in window;
}

// Folders/files to ignore when reading directory
const IGNORED_NAMES = new Set([
  "node_modules",
  ".git",
  ".next",
  "__pycache__",
  ".venv",
  "venv",
  ".env",
  "dist",
  "build",
  ".cache",
  ".DS_Store",
  "Thumbs.db",
]);

/**
 * Open a folder picker dialog and return the directory handle
 */
export async function openFolderPicker(): Promise<FileSystemDirectoryHandle | null> {
  if (!isFileSystemAccessSupported()) {
    alert("Your browser doesn't support the File System Access API. Please use Chrome, Edge, or another Chromium-based browser.");
    return null;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handle = await (window as any).showDirectoryPicker({
      mode: "readwrite",
    });
    return handle;
  } catch (err) {
    // User cancelled the picker
    if (err instanceof Error && err.name === "AbortError") {
      return null;
    }
    console.error("Error opening folder:", err);
    return null;
  }
}

/**
 * Read a directory recursively and build a FileNode tree
 */
export async function readDirectory(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dirHandle: any,
  parentPath: string = "",
  maxDepth: number = 5
): Promise<FileNode[]> {
  if (maxDepth <= 0) return [];

  const nodes: FileNode[] = [];
  const currentPath = parentPath ? `${parentPath}/${dirHandle.name}` : dirHandle.name;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for await (const entry of (dirHandle as any).values()) {
      // Skip ignored files/folders
      if (IGNORED_NAMES.has(entry.name)) continue;
      // Skip hidden files (starting with .)
      if (entry.name.startsWith(".") && entry.name !== ".env.example") continue;

      const entryPath = `${currentPath}/${entry.name}`;

      if (entry.kind === "directory") {
        const children = await readDirectory(entry, currentPath, maxDepth - 1);
        nodes.push({
          id: entryPath,
          name: entry.name,
          type: "folder",
          children,
          isOpen: false,
          handle: entry,
          path: entryPath,
        });
      } else {
        nodes.push({
          id: entryPath,
          name: entry.name,
          type: "file",
          language: getLanguageFromFilename(entry.name),
          handle: entry,
          path: entryPath,
        });
      }
    }
  } catch (err) {
    console.error(`Error reading directory ${currentPath}:`, err);
  }

  // Sort: folders first, then alphabetically
  return nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Read file content from a FileSystemFileHandle
 * Returns empty string for binary files or on error
 */
export async function readFileContent(handle: FileSystemFileHandle): Promise<string> {
  try {
    // Request permission if needed (for persisted handles)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleWithPermission = handle as any;
    if (handleWithPermission.queryPermission) {
      const permission = await handleWithPermission.queryPermission({ mode: 'read' });
      if (permission !== 'granted') {
        const requestResult = await handleWithPermission.requestPermission({ mode: 'read' });
        if (requestResult !== 'granted') {
          console.warn(`[readFileContent] Permission denied for ${handle.name}`);
          return `// Permission denied: ${handle.name}`;
        }
      }
    }
    
    const file = await handle.getFile();
    
    // Skip binary files based on MIME type
    const binaryTypes = [
      'image/', 'audio/', 'video/', 'application/octet-stream',
      'application/zip', 'application/x-tar', 'application/gzip',
      'application/pdf', 'application/x-executable',
    ];
    if (binaryTypes.some(t => file.type.startsWith(t))) {
      console.log(`[readFileContent] Skipping binary file: ${file.name} (${file.type})`);
      return `// Binary file: ${file.name}`;
    }
    
    const content = await file.text();
    return content;
  } catch (err) {
    console.error(`[readFileContent] Error reading file ${handle.name}:`, err);
    return "";
  }
}

/**
 * Write content to a file using FileSystemFileHandle
 */
export async function writeFileContent(
  handle: FileSystemFileHandle,
  content: string
): Promise<boolean> {
  try {
    const writable = await handle.createWritable();
    await writable.write(content);
    await writable.close();
    return true;
  } catch (err) {
    console.error("Error writing file:", err);
    return false;
  }
}

/**
 * Create a new file in a directory
 */
export async function createFile(
  dirHandle: FileSystemDirectoryHandle,
  filename: string,
  content: string = ""
): Promise<FileSystemFileHandle | null> {
  try {
    const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
    if (content) {
      await writeFileContent(fileHandle, content);
    }
    return fileHandle;
  } catch (err) {
    console.error("Error creating file:", err);
    return null;
  }
}

/**
 * Create a new folder in a directory
 */
export async function createFolder(
  dirHandle: FileSystemDirectoryHandle,
  folderName: string
): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await dirHandle.getDirectoryHandle(folderName, { create: true });
  } catch (err) {
    console.error("Error creating folder:", err);
    return null;
  }
}
