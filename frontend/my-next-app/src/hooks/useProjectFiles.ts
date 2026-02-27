"use client";

/**
 * useProjectFiles Hook — Manages project file tree and provides file lookup
 * 
 * Integrates with File System Access API for real folders
 * Provides file content lookup for multi-file edit operations
 */

import { useState, useCallback, useRef } from "react";
import {
  FileNode,
  openFolderPicker,
  readDirectory,
  readFileContent,
  writeFileContent,
  createFile,
} from "../services/fileSystemService";

export interface UseProjectFilesReturn {
  // State
  fileTree: FileNode[];
  rootHandle: FileSystemDirectoryHandle | null;
  folderName: string;
  isLoading: boolean;
  error: string | null;
  
  // File operations
  openFolder: () => Promise<boolean>;
  getFileContent: (filePath: string) => Promise<{ content: string; handle?: FileSystemFileHandle }>;
  writeFile: (filePath: string, content: string) => Promise<boolean>;
  createNewFile: (filePath: string, content: string) => Promise<FileSystemFileHandle | null>;
  findFileNode: (filePath: string) => FileNode | null;
  refreshTree: () => Promise<void>;
  
  // Helpers
  collectAllFiles: () => FileNode[];
  getFileByPath: (path: string) => FileNode | null;
}

/**
 * Flatten file tree into array of file nodes
 */
function collectFiles(nodes: FileNode[]): FileNode[] {
  const result: FileNode[] = [];
  const walk = (n: FileNode): void => {
    if (n.type === "file") result.push(n);
    n.children?.forEach(walk);
  };
  nodes.forEach(walk);
  return result;
}

/**
 * Find a file node by its path
 */
function findByPath(nodes: FileNode[], targetPath: string): FileNode | null {
  const normalizedTarget = targetPath.replace(/\\/g, "/").toLowerCase();
  
  const walk = (n: FileNode): FileNode | null => {
    const normalizedPath = n.path.replace(/\\/g, "/").toLowerCase();
    if (normalizedPath === normalizedTarget || normalizedPath.endsWith(normalizedTarget)) {
      return n;
    }
    if (n.children) {
      for (const child of n.children) {
        const found = walk(child);
        if (found) return found;
      }
    }
    return null;
  };
  
  for (const node of nodes) {
    const found = walk(node);
    if (found) return found;
  }
  return null;
}

/**
 * Navigate to a directory handle by path segments
 */
async function navigateToDirectory(
  rootHandle: FileSystemDirectoryHandle,
  pathSegments: string[]
): Promise<FileSystemDirectoryHandle | null> {
  let current = rootHandle;
  for (const segment of pathSegments) {
    try {
      current = await current.getDirectoryHandle(segment);
    } catch {
      return null;
    }
  }
  return current;
}

export function useProjectFiles(): UseProjectFilesReturn {
  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [rootHandle, setRootHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [folderName, setFolderName] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Cache for file contents to avoid re-reading
  const contentCache = useRef<Map<string, { content: string; timestamp: number }>>(new Map());

  // Open a folder using File System Access API
  const openFolder = useCallback(async (): Promise<boolean> => {
    setIsLoading(true);
    setError(null);
    
    try {
      const handle = await openFolderPicker();
      if (!handle) {
        setIsLoading(false);
        return false;
      }
      
      setRootHandle(handle);
      setFolderName(handle.name);
      
      // Read directory tree
      const tree = await readDirectory(handle, "", 5);
      setFileTree(tree);
      setIsLoading(false);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to open folder";
      setError(message);
      setIsLoading(false);
      return false;
    }
  }, []);

  // Refresh the file tree
  const refreshTree = useCallback(async (): Promise<void> => {
    if (!rootHandle) return;
    
    setIsLoading(true);
    try {
      const tree = await readDirectory(rootHandle, "", 5);
      setFileTree(tree);
      contentCache.current.clear();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to refresh";
      setError(message);
    }
    setIsLoading(false);
  }, [rootHandle]);

  // Find a file node by path
  const findFileNode = useCallback((filePath: string): FileNode | null => {
    return findByPath(fileTree, filePath);
  }, [fileTree]);

  // Get file content by path
  const getFileContent = useCallback(async (
    filePath: string
  ): Promise<{ content: string; handle?: FileSystemFileHandle }> => {
    // Check cache first (valid for 5 seconds)
    const cached = contentCache.current.get(filePath);
    if (cached && Date.now() - cached.timestamp < 5000) {
      const node = findByPath(fileTree, filePath);
      return { content: cached.content, handle: node?.handle };
    }
    
    // Find in file tree
    const node = findByPath(fileTree, filePath);
    if (node && node.type === "file") {
      // If we have cached content in the node
      if (node.content) {
        contentCache.current.set(filePath, { content: node.content, timestamp: Date.now() });
        return { content: node.content, handle: node.handle };
      }
      
      // Read from handle
      if (node.handle) {
        try {
          const content = await readFileContent(node.handle);
          contentCache.current.set(filePath, { content, timestamp: Date.now() });
          return { content, handle: node.handle };
        } catch (err) {
          console.error(`Failed to read file ${filePath}:`, err);
        }
      }
    }
    
    // File not found in tree — return empty
    return { content: "" };
  }, [fileTree]);

  // Write content to a file
  const writeFile = useCallback(async (
    filePath: string,
    content: string
  ): Promise<boolean> => {
    const node = findByPath(fileTree, filePath);
    if (!node || !node.handle) {
      setError(`File not found: ${filePath}`);
      return false;
    }
    
    try {
      const success = await writeFileContent(node.handle, content);
      if (success) {
        // Update cache
        contentCache.current.set(filePath, { content, timestamp: Date.now() });
      }
      return success;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Write failed";
      setError(message);
      return false;
    }
  }, [fileTree]);

  // Create a new file
  const createNewFile = useCallback(async (
    filePath: string,
    content: string
  ): Promise<FileSystemFileHandle | null> => {
    if (!rootHandle) {
      setError("No folder open");
      return null;
    }
    
    // Parse path to get directory and filename
    const normalizedPath = filePath.replace(/\\/g, "/");
    const segments = normalizedPath.split("/").filter(Boolean);
    const filename = segments.pop();
    
    if (!filename) {
      setError("Invalid file path");
      return null;
    }
    
    try {
      // Navigate to target directory
      let targetDir = rootHandle;
      if (segments.length > 0) {
        const dir = await navigateToDirectory(rootHandle, segments);
        if (!dir) {
          setError(`Directory not found: ${segments.join("/")}`);
          return null;
        }
        targetDir = dir;
      }
      
      // Create the file
      const handle = await createFile(targetDir, filename, content);
      if (handle) {
        // Refresh tree to include new file
        await refreshTree();
      }
      return handle;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Create failed";
      setError(message);
      return null;
    }
  }, [rootHandle, refreshTree]);

  // Collect all files in tree
  const collectAllFiles = useCallback((): FileNode[] => {
    return collectFiles(fileTree);
  }, [fileTree]);

  // Get file by path (alias for findFileNode)
  const getFileByPath = useCallback((path: string): FileNode | null => {
    return findByPath(fileTree, path);
  }, [fileTree]);

  return {
    fileTree,
    rootHandle,
    folderName,
    isLoading,
    error,
    openFolder,
    getFileContent,
    writeFile,
    createNewFile,
    findFileNode,
    refreshTree,
    collectAllFiles,
    getFileByPath,
  };
}
