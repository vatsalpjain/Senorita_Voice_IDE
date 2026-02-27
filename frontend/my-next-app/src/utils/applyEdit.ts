/**
 * Apply Edit Utilities — Compute new file content from edit instructions
 * 
 * Takes original content + edit instruction → produces proposed content
 * This is pure computation, no side effects (doesn't write to disk)
 */

import { EditAction, EditInstruction, PendingEdit } from "../types/edits";

/**
 * Generate a unique ID for an edit
 */
export function generateEditId(): string {
  return `edit-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Apply an edit action to original content and return the new content
 * All line numbers are 1-indexed (matching Monaco editor)
 */
export function computeProposedContent(
  originalContent: string,
  action: EditAction,
  code: string,
  options: {
    insertAtLine?: number;
    startLine?: number;
    endLine?: number;
  } = {}
): string {
  const lines = originalContent.split("\n");
  const { insertAtLine, startLine, endLine } = options;

  switch (action) {
    case "insert": {
      // Insert code at specified line (1-indexed)
      // If insertAtLine is 5, code goes BEFORE line 5
      const lineIndex = Math.max(0, Math.min((insertAtLine ?? 1) - 1, lines.length));
      const codeLines = code.split("\n");
      lines.splice(lineIndex, 0, ...codeLines);
      return lines.join("\n");
    }

    case "replace_selection": {
      // Replace lines from startLine to endLine (inclusive, 1-indexed)
      const start = Math.max(0, (startLine ?? 1) - 1);
      const end = Math.min(lines.length, endLine ?? startLine ?? 1);
      const deleteCount = end - start;
      const codeLines = code.split("\n");
      lines.splice(start, deleteCount, ...codeLines);
      return lines.join("\n");
    }

    case "replace_file": {
      // Replace entire file content
      return code;
    }

    case "create_file": {
      // For new files, the code IS the content
      return code;
    }

    case "delete_lines": {
      // Delete lines from startLine to endLine (inclusive, 1-indexed)
      const start = Math.max(0, (startLine ?? 1) - 1);
      const end = Math.min(lines.length, endLine ?? startLine ?? 1);
      const deleteCount = end - start;
      lines.splice(start, deleteCount);
      return lines.join("\n");
    }

    default:
      // Unknown action — return original
      return originalContent;
  }
}

/**
 * Convert a backend EditInstruction to a PendingEdit
 * Requires the original file content to compute the proposed content
 */
export function instructionToPendingEdit(
  instruction: EditInstruction,
  originalContent: string,
  fileHandle?: FileSystemFileHandle
): PendingEdit {
  const proposedContent = computeProposedContent(
    originalContent,
    instruction.action,
    instruction.code,
    {
      insertAtLine: instruction.insert_at_line,
      startLine: instruction.start_line,
      endLine: instruction.end_line,
    }
  );

  return {
    id: generateEditId(),
    filePath: instruction.file_path,
    originalContent,
    proposedContent,
    action: instruction.action,
    code: instruction.code,
    insertAtLine: instruction.insert_at_line,
    startLine: instruction.start_line,
    endLine: instruction.end_line,
    status: "pending",
    fileHandle,
  };
}

/**
 * Process multiple edit instructions into PendingEdits
 * Requires a function to fetch file content by path
 */
export async function processEditInstructions(
  instructions: EditInstruction[],
  getFileContent: (filePath: string) => Promise<{ content: string; handle?: FileSystemFileHandle }>,
  explanation?: string
): Promise<PendingEdit[]> {
  const pendingEdits: PendingEdit[] = [];

  for (const instruction of instructions) {
    try {
      // For create_file, original content is empty
      let originalContent = "";
      let fileHandle: FileSystemFileHandle | undefined;

      if (instruction.action !== "create_file") {
        const fileData = await getFileContent(instruction.file_path);
        originalContent = fileData.content;
        fileHandle = fileData.handle;
      }

      const pendingEdit = instructionToPendingEdit(instruction, originalContent, fileHandle);
      pendingEdit.explanation = explanation;
      pendingEdits.push(pendingEdit);
    } catch (err) {
      console.error(`Failed to process edit for ${instruction.file_path}:`, err);
      // Continue with other edits
    }
  }

  return pendingEdits;
}

/**
 * Compute a simple diff summary between original and proposed content
 * Returns counts of added/removed/changed lines
 */
export function computeDiffSummary(
  originalContent: string,
  proposedContent: string
): { added: number; removed: number; unchanged: number } {
  const originalLines = originalContent.split("\n");
  const proposedLines = proposedContent.split("\n");

  // Simple line-based diff (not a full diff algorithm)
  const originalSet = new Set(originalLines);
  const proposedSet = new Set(proposedLines);

  let added = 0;
  let removed = 0;
  let unchanged = 0;

  for (const line of proposedLines) {
    if (originalSet.has(line)) {
      unchanged++;
    } else {
      added++;
    }
  }

  for (const line of originalLines) {
    if (!proposedSet.has(line)) {
      removed++;
    }
  }

  return { added, removed, unchanged };
}

/**
 * Get a human-readable description of an edit action
 */
export function describeEditAction(edit: PendingEdit): string {
  switch (edit.action) {
    case "insert":
      return `Insert at line ${edit.insertAtLine ?? 1}`;
    case "replace_selection":
      return `Replace lines ${edit.startLine ?? 1}-${edit.endLine ?? edit.startLine ?? 1}`;
    case "replace_file":
      return "Replace entire file";
    case "create_file":
      return "Create new file";
    case "delete_lines":
      return `Delete lines ${edit.startLine ?? 1}-${edit.endLine ?? edit.startLine ?? 1}`;
    default:
      return "Unknown action";
  }
}
