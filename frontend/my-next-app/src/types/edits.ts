/**
 * Edit Types — Data structures for diff-based edit approval workflow
 * 
 * Flow: Backend proposes edits → Frontend shows diff → User accepts/rejects → Write to disk
 */

// Action types matching backend CodeActionData
export type EditAction =
  | "insert"           // Insert code at a specific line
  | "replace_selection" // Replace selected code range
  | "replace_file"     // Replace entire file content
  | "create_file"      // Create a new file
  | "delete_lines";    // Delete lines from start to end

// Status of a pending edit
export type EditStatus = "pending" | "accepted" | "rejected";

/**
 * A single proposed edit to a file
 * Backend generates these, frontend displays for approval
 */
export interface PendingEdit {
  // Unique identifier for this edit
  id: string;
  
  // File information
  filePath: string;                    // Relative path within project
  originalContent: string;             // Content before edit
  proposedContent: string;             // Content after edit (computed by applyEdit)
  
  // Edit details from backend
  action: EditAction;
  code: string;                        // The code to insert/replace with
  insertAtLine?: number;               // For "insert" action — 1-indexed line number
  startLine?: number;                  // For "replace_selection" / "delete_lines"
  endLine?: number;                    // For "replace_selection" / "delete_lines"
  
  // Metadata
  explanation?: string;                // AI explanation of the change
  status: EditStatus;
  
  // File System Access API handle (for writing to disk)
  fileHandle?: FileSystemFileHandle;
}

/**
 * A single edit instruction from the backend (before processing)
 * This is the raw format received from the agent
 */
export interface EditInstruction {
  file_path: string;
  action: EditAction;
  code: string;
  insert_at_line?: number;
  start_line?: number;
  end_line?: number;
}

/**
 * Multi-file edit response from backend coding agent
 */
export interface MultiFileEditResponse {
  edits: EditInstruction[];
  explanation: string;
}

/**
 * State for managing all pending edits
 */
export interface PendingEditsState {
  // All pending edits across files
  edits: PendingEdit[];
  
  // Currently selected edit for diff view
  activeEditId: string | null;
  
  // Loading state while processing
  isProcessing: boolean;
  
  // Error message if something failed
  error: string | null;
}

/**
 * Actions for the pending edits reducer
 */
export type PendingEditsAction =
  | { type: "ADD_EDITS"; payload: PendingEdit[] }
  | { type: "SET_ACTIVE"; payload: string | null }
  | { type: "ACCEPT_EDIT"; payload: string }
  | { type: "REJECT_EDIT"; payload: string }
  | { type: "ACCEPT_ALL" }
  | { type: "REJECT_ALL" }
  | { type: "CLEAR_COMPLETED" }
  | { type: "SET_PROCESSING"; payload: boolean }
  | { type: "SET_ERROR"; payload: string | null };

/**
 * Initial state for pending edits
 */
export const initialPendingEditsState: PendingEditsState = {
  edits: [],
  activeEditId: null,
  isProcessing: false,
  error: null,
};

/**
 * Reducer for pending edits state management
 */
export function pendingEditsReducer(
  state: PendingEditsState,
  action: PendingEditsAction
): PendingEditsState {
  switch (action.type) {
    case "ADD_EDITS":
      return {
        ...state,
        edits: [...state.edits, ...action.payload],
        // Auto-select first edit if none selected
        activeEditId: state.activeEditId ?? action.payload[0]?.id ?? null,
      };

    case "SET_ACTIVE":
      return { ...state, activeEditId: action.payload };

    case "ACCEPT_EDIT":
      return {
        ...state,
        edits: state.edits.map((e) =>
          e.id === action.payload ? { ...e, status: "accepted" as const } : e
        ),
      };

    case "REJECT_EDIT":
      return {
        ...state,
        edits: state.edits.map((e) =>
          e.id === action.payload ? { ...e, status: "rejected" as const } : e
        ),
      };

    case "ACCEPT_ALL":
      return {
        ...state,
        edits: state.edits.map((e) =>
          e.status === "pending" ? { ...e, status: "accepted" as const } : e
        ),
      };

    case "REJECT_ALL":
      return {
        ...state,
        edits: state.edits.map((e) =>
          e.status === "pending" ? { ...e, status: "rejected" as const } : e
        ),
      };

    case "CLEAR_COMPLETED":
      return {
        ...state,
        edits: state.edits.filter((e) => e.status === "pending"),
        activeEditId: null,
      };

    case "SET_PROCESSING":
      return { ...state, isProcessing: action.payload };

    case "SET_ERROR":
      return { ...state, error: action.payload };

    default:
      return state;
  }
}
