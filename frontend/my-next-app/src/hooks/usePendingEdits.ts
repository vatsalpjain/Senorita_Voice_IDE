"use client";

/**
 * usePendingEdits Hook — State management for diff-based edit approval
 * 
 * Manages pending edits from AI agents, handles accept/reject actions,
 * and writes accepted edits to disk via File System Access API
 */

import { useReducer, useCallback, useMemo } from "react";
import {
  PendingEdit,
  EditInstruction,
  pendingEditsReducer,
  initialPendingEditsState,
} from "../types/edits";
import { processEditInstructions } from "../utils/applyEdit";
import { writeFileContent } from "../services/fileSystemService";

export interface UsePendingEditsOptions {
  // Called when an edit is accepted — use to sync editor content
  onEditAccepted?: (edit: PendingEdit) => void;
  // Called to create a new file (for create_file action)
  createFile?: (filePath: string, content: string) => Promise<FileSystemFileHandle | null>;
}

export interface UsePendingEditsReturn {
  // State
  edits: PendingEdit[];
  activeEdit: PendingEdit | null;
  pendingCount: number;
  acceptedCount: number;
  rejectedCount: number;
  isProcessing: boolean;
  error: string | null;
  
  // Actions
  addEditsFromInstructions: (
    instructions: EditInstruction[],
    getFileContent: (filePath: string) => Promise<{ content: string; handle?: FileSystemFileHandle }>,
    explanation?: string
  ) => Promise<void>;
  setActiveEdit: (editId: string | null) => void;
  acceptEdit: (editId: string) => Promise<boolean>;
  rejectEdit: (editId: string) => void;
  acceptAll: () => Promise<{ success: number; failed: number }>;
  rejectAll: () => void;
  clearCompleted: () => void;
}

export function usePendingEdits(options: UsePendingEditsOptions = {}): UsePendingEditsReturn {
  const { onEditAccepted, createFile } = options;
  const [state, dispatch] = useReducer(pendingEditsReducer, initialPendingEditsState);

  // Computed values
  const activeEdit = useMemo(
    () => state.edits.find((e) => e.id === state.activeEditId) ?? null,
    [state.edits, state.activeEditId]
  );

  const pendingCount = useMemo(
    () => state.edits.filter((e) => e.status === "pending").length,
    [state.edits]
  );

  const acceptedCount = useMemo(
    () => state.edits.filter((e) => e.status === "accepted").length,
    [state.edits]
  );

  const rejectedCount = useMemo(
    () => state.edits.filter((e) => e.status === "rejected").length,
    [state.edits]
  );

  // Add edits from backend instructions
  const addEditsFromInstructions = useCallback(
    async (
      instructions: EditInstruction[],
      getFileContent: (filePath: string) => Promise<{ content: string; handle?: FileSystemFileHandle }>,
      explanation?: string
    ) => {
      dispatch({ type: "SET_PROCESSING", payload: true });
      dispatch({ type: "SET_ERROR", payload: null });

      try {
        const pendingEdits = await processEditInstructions(
          instructions,
          getFileContent,
          explanation
        );

        if (pendingEdits.length > 0) {
          dispatch({ type: "ADD_EDITS", payload: pendingEdits });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to process edits";
        dispatch({ type: "SET_ERROR", payload: message });
      } finally {
        dispatch({ type: "SET_PROCESSING", payload: false });
      }
    },
    []
  );

  // Set active edit for diff view
  const setActiveEdit = useCallback((editId: string | null) => {
    dispatch({ type: "SET_ACTIVE", payload: editId });
  }, []);

  // Accept a single edit and write to disk
  const acceptEdit = useCallback(
    async (editId: string): Promise<boolean> => {
      const edit = state.edits.find((e) => e.id === editId);
      if (!edit || edit.status !== "pending") return false;

      // Handle create_file action
      if (edit.action === "create_file" && createFile) {
        try {
          const handle = await createFile(edit.filePath, edit.proposedContent);
          if (!handle) {
            dispatch({ type: "SET_ERROR", payload: `Failed to create ${edit.filePath}` });
            return false;
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : "Create failed";
          dispatch({ type: "SET_ERROR", payload: message });
          return false;
        }
      } else if (edit.fileHandle) {
        // Write to disk if we have a file handle
        try {
          const success = await writeFileContent(edit.fileHandle, edit.proposedContent);
          if (!success) {
            dispatch({ type: "SET_ERROR", payload: `Failed to write ${edit.filePath}` });
            return false;
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : "Write failed";
          dispatch({ type: "SET_ERROR", payload: message });
          return false;
        }
      }

      dispatch({ type: "ACCEPT_EDIT", payload: editId });
      
      // Notify callback for editor sync
      onEditAccepted?.(edit);
      
      // Move to next pending edit
      const nextPending = state.edits.find(
        (e) => e.id !== editId && e.status === "pending"
      );
      if (nextPending) {
        dispatch({ type: "SET_ACTIVE", payload: nextPending.id });
      }

      return true;
    },
    [state.edits, onEditAccepted, createFile]
  );

  // Reject a single edit
  const rejectEdit = useCallback((editId: string) => {
    dispatch({ type: "REJECT_EDIT", payload: editId });
    
    // Move to next pending edit
    const nextPending = state.edits.find(
      (e) => e.id !== editId && e.status === "pending"
    );
    if (nextPending) {
      dispatch({ type: "SET_ACTIVE", payload: nextPending.id });
    }
  }, [state.edits]);

  // Accept all pending edits
  const acceptAll = useCallback(async (): Promise<{ success: number; failed: number }> => {
    dispatch({ type: "SET_PROCESSING", payload: true });
    
    let success = 0;
    let failed = 0;

    const pendingEdits = state.edits.filter((e) => e.status === "pending");

    for (const edit of pendingEdits) {
      let writeSuccess = false;
      
      // Handle create_file action
      if (edit.action === "create_file" && createFile) {
        try {
          const handle = await createFile(edit.filePath, edit.proposedContent);
          writeSuccess = !!handle;
        } catch {
          writeSuccess = false;
        }
      } else if (edit.fileHandle) {
        try {
          writeSuccess = await writeFileContent(edit.fileHandle, edit.proposedContent);
        } catch {
          writeSuccess = false;
        }
      } else {
        // No file handle and not create_file — mark as accepted anyway
        writeSuccess = true;
      }
      
      if (writeSuccess) {
        dispatch({ type: "ACCEPT_EDIT", payload: edit.id });
        onEditAccepted?.(edit);
        success++;
      } else {
        failed++;
      }
    }

    dispatch({ type: "SET_PROCESSING", payload: false });
    return { success, failed };
  }, [state.edits, onEditAccepted, createFile]);

  // Reject all pending edits
  const rejectAll = useCallback(() => {
    dispatch({ type: "REJECT_ALL" });
  }, []);

  // Clear completed (accepted/rejected) edits
  const clearCompleted = useCallback(() => {
    dispatch({ type: "CLEAR_COMPLETED" });
  }, []);

  return {
    edits: state.edits,
    activeEdit,
    pendingCount,
    acceptedCount,
    rejectedCount,
    isProcessing: state.isProcessing,
    error: state.error,
    addEditsFromInstructions,
    setActiveEdit,
    acceptEdit,
    rejectEdit,
    acceptAll,
    rejectAll,
    clearCompleted,
  };
}
