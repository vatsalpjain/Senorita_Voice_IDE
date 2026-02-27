"use client";

/* ============================================================
   AI SERVICE — Voice Command → Backend → Structured Response
   ============================================================
   Primary path: WebSocket streaming  (ws://…/ws/voice)
   Fallback:     REST               (POST /api/command)
   Last resort:  Client-side mocks
   ============================================================ */

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export const WS_URL =
  process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8000/ws/voice";

/* ============================================================
   AGENTIC COMMAND REQUEST
   ============================================================ */
export interface AgenticCommandRequest {
  text: string;
  file_path: string;
  file_content?: string;
  cursor_line?: number;
  selection?: string;
  project_root?: string;
  error_message?: string;
  mode?: "auto" | "coding" | "debug" | "workflow" | "explain";
  skip_tts?: boolean;
}

/**
 * Build an agentic_command message payload for WebSocket.
 */
export function buildAgenticCommand(req: AgenticCommandRequest): object {
  return {
    type: "agentic_command",
    text: req.text,
    file_path: req.file_path,
    file_content: req.file_content ?? "",
    cursor_line: req.cursor_line ?? 1,
    selection: req.selection ?? "",
    project_root: req.project_root ?? "",
    error_message: req.error_message ?? "",
    mode: req.mode ?? "auto",
    skip_tts: req.skip_tts ?? true,
  };
}

/* ============================================================
   REQUEST / RESPONSE TYPES
   ============================================================ */

export type CommandIntent =
  | "generate"    // write new code
  | "refactor"    // rewrite existing code
  | "explain"     // explain selected code
  | "fix"         // fix a bug
  | "test"        // generate tests
  | "document"    // add docs/comments
  | "unknown";    // fallback

export interface VoiceCommandRequest {
  transcript: string;
  context: EditorContext;
}

export interface EditorContext {
  language: string;
  filename: string;
  currentCode: string;
  cursorLine?: number;
  selection?: string;
  projectRoot?: string;  // Root directory of the project for symbol indexing
}

export interface AICommandResponse {
  intent: CommandIntent;
  code: string | null;
  explanation: string;
  insertMode: "replace" | "append" | "cursor" | "none";
  targetLine?: number;
  error?: string;
}

/* ============================================================
   WS MESSAGE TYPES  (from backend /ws/voice)
   ============================================================ */
export interface WSActionMsg   { type: "action";            action: string; param: string; }
export interface WSChunkMsg    { type: "llm_chunk";         text: string; }
export interface WSCompleteMsg { type: "response_complete"; action: string; text: string; code: string | null; }
export interface WSErrorMsg    { type: "error";             message: string; }
export interface WSConnected   { type: "connected";         message: string; }

// New agentic workflow messages
export interface WSIntentMsg   { type: "intent";            intent: string; }
export interface WSAgentResultMsg {
  type: "agent_result";
  result_type: "code_action" | "debug_result" | "workflow_result" | "explanation" | "chat";
  data: CodeActionData | DebugResultData | WorkflowResultData | ExplanationData;
}
export interface WSAgentCompleteMsg {
  type: "response_complete";
  intent: string;
  result: { type: string; data: unknown } | null;
  text: string;
  error: string | null;
}

// Single edit within a multi-file response
export interface SingleEditData {
  file_path: string;
  action: "insert" | "replace_selection" | "replace_file" | "create_file" | "delete_lines";
  code: string;
  insert_at_line?: number;
  start_line?: number;
  end_line?: number;
}

// Agent result data types — now supports multi-file edits
export interface CodeActionData {
  edits: SingleEditData[];
  explanation: string;
}

export interface DebugResultData {
  bugs: Array<{
    bug_line: number;
    bug_description: string;
    severity: "error" | "warning" | "suggestion";
    fix_code: string;
    explanation: string;
  }>;
  summary: string;
  has_critical: boolean;
  suggested_action: string;
}

export interface WorkflowResultData {
  workflow: string;
  status: "triggered" | "not_configured" | "error";
  message: string;
  payload: Record<string, unknown>;
}

export interface ExplanationData {
  text: string;
  files_to_open?: Array<{ filename: string; path: string }>;
}

export type WSIncomingMsg =
  | WSActionMsg | WSChunkMsg | WSCompleteMsg
  | WSErrorMsg  | WSConnected
  | WSIntentMsg | WSAgentResultMsg | WSAgentCompleteMsg
  | { type: string; [key: string]: unknown };

/* ============================================================
   WS STREAMING CALLBACKS
   ============================================================ */
export interface StreamCallbacks {
  // Legacy callbacks
  onAction?:   (action: string, param: string) => void;
  onChunk?:    (chunk: string)  => void;
  onComplete?: (text: string, action: string, code: string | null) => void;
  onError?:    (message: string) => void;
  // Agentic callbacks
  onIntent?:       (intent: string) => void;
  onCodeAction?:   (data: CodeActionData) => void;
  onDebugResult?:  (data: DebugResultData) => void;
  onWorkflowResult?: (data: WorkflowResultData) => void;
  onExplanation?:  (data: ExplanationData) => void;
  onAgentComplete?: (intent: string, result: unknown, text: string, error: string | null) => void;
}

/**
 * Dispatch an incoming WS message to the appropriate callback.
 * Called from VoicePanel's onMessage handler.
 * Supports both legacy and agentic message types.
 */
export function dispatchWSMessage(
  msg: WSIncomingMsg,
  callbacks: StreamCallbacks
): void {
  switch (msg.type) {
    // Legacy message types
    case "action":
      callbacks.onAction?.((msg as WSActionMsg).action, (msg as WSActionMsg).param);
      break;
    case "llm_chunk":
      callbacks.onChunk?.((msg as WSChunkMsg).text);
      break;
    case "error":
      callbacks.onError?.((msg as WSErrorMsg).message);
      break;

    // Agentic message types
    case "intent":
      callbacks.onIntent?.((msg as WSIntentMsg).intent);
      break;
    case "agent_result": {
      const agentMsg = msg as WSAgentResultMsg;
      switch (agentMsg.result_type) {
        case "code_action":
          callbacks.onCodeAction?.(agentMsg.data as CodeActionData);
          break;
        case "debug_result":
          callbacks.onDebugResult?.(agentMsg.data as DebugResultData);
          break;
        case "workflow_result":
          callbacks.onWorkflowResult?.(agentMsg.data as WorkflowResultData);
          break;
        case "explanation":
        case "chat":
          callbacks.onExplanation?.(agentMsg.data as ExplanationData);
          break;
      }
      break;
    }
    case "response_complete": {
      // Handle both legacy and agentic complete messages
      const completeMsg = msg as WSCompleteMsg & WSAgentCompleteMsg;
      if ("intent" in completeMsg && completeMsg.intent) {
        // Agentic complete
        callbacks.onAgentComplete?.(
          completeMsg.intent,
          completeMsg.result,
          completeMsg.text,
          completeMsg.error,
        );
      } else {
        // Legacy complete
        callbacks.onComplete?.(
          completeMsg.text,
          completeMsg.action,
          completeMsg.code,
        );
      }
      break;
    }
  }
}

/* ============================================================
   INTENT ROUTER (client-side keyword sniff as fallback)
   ============================================================ */
const INTENT_PATTERNS: Array<{ pattern: RegExp; intent: CommandIntent }> = [
  { pattern: /\b(write|create|generate|add|build|make)\b/i,          intent: "generate"  },
  { pattern: /\b(refactor|rewrite|clean|improve|optimize|rename)\b/i, intent: "refactor"  },
  { pattern: /\b(explain|what does|what is|describe|tell me)\b/i,     intent: "explain"   },
  { pattern: /\b(fix|debug|error|bug|broken|issue|wrong)\b/i,         intent: "fix"       },
  { pattern: /\b(test|spec|unit test|jest|vitest)\b/i,                intent: "test"      },
  { pattern: /\b(document|comment|jsdoc|docstring)\b/i,               intent: "document"  },
];

export function classifyIntent(transcript: string): CommandIntent {
  for (const { pattern, intent } of INTENT_PATTERNS) {
    if (pattern.test(transcript)) return intent;
  }
  return "unknown";
}

/**
 * Map backend action strings to frontend CommandIntent.
 */
export function actionToIntent(action: string): CommandIntent {
  const map: Record<string, CommandIntent> = {
    GENERATE_CODE: "generate",
    DEBUG_MODE:    "fix",
    REVIEW_MODE:   "refactor",
    EXPLAIN_CODE:  "explain",
  };
  return map[action] ?? "unknown";
}

/* ============================================================
   REST FALLBACK — POST /api/command
   ============================================================ */
export async function sendVoiceCommand(
  request: VoiceCommandRequest,
  signal?: AbortSignal
): Promise<AICommandResponse> {
  const response = await fetch(`${API_BASE}/api/command`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      transcript: request.transcript,
      context: request.context.currentCode || undefined,
    }),
    signal,
  });

  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const err = await response.json();
      detail = err?.detail ?? err?.message ?? detail;
    } catch (_) { /* ignore parse error */ }
    throw new Error(detail);
  }

  const data = await response.json();

  // Map backend SenoResponse → AICommandResponse
  return {
    intent: actionToIntent(data.action ?? "UNKNOWN"),
    code: data.llm_response ?? null,
    explanation: data.llm_response ?? data.instruction ?? "Done.",
    insertMode: "none",
  };
}

/* ============================================================
   MOCK RESPONSE — used when backend is not yet connected
   ============================================================ */
const MOCK_RESPONSES: Record<CommandIntent, (req: VoiceCommandRequest) => AICommandResponse> = {
  generate: (req) => ({
    intent: "generate",
    insertMode: "append",
    explanation: `Generated code based on: "${req.transcript}"`,
    code: `// Generated by VoiceIDE — "${req.transcript}"
async function generatedFunction() {
  // TODO: implement logic
  return null;
}`,
  }),
  refactor: (req) => ({
    intent: "refactor",
    insertMode: "replace",
    explanation: `Refactored the current selection based on: "${req.transcript}"`,
    code: `// Refactored by VoiceIDE
${req.context.selection
  ? req.context.selection
      .split("\n")
      .map((l) => l.trimEnd())
      .join("\n")
  : "// (no selection — refactored full file)"}`,
  }),
  explain: (req) => ({
    intent: "explain",
    insertMode: "none",
    explanation: `This code in ${req.context.filename} appears to handle core functionality. Voice command received: "${req.transcript}"`,
    code: null,
  }),
  fix: (req) => ({
    intent: "fix",
    insertMode: "replace",
    explanation: `Fixed potential issues based on: "${req.transcript}"`,
    code: `// Fixed by VoiceIDE
${req.context.selection ?? req.context.currentCode.slice(0, 200)}
// ↑ Applied fix: added null checks and error handling`,
  }),
  test: (req) => ({
    intent: "test",
    insertMode: "append",
    explanation: `Generated tests for ${req.context.filename}`,
    code: `// Tests generated by VoiceIDE — "${req.transcript}"
describe('${req.context.filename.replace(/\.[^.]+$/, "")}', () => {
  it('should work correctly', () => {
    expect(true).toBe(true);
  });
});`,
  }),
  document: (req) => ({
    intent: "document",
    insertMode: "append",
    explanation: `Added documentation for ${req.context.filename}`,
    code: `/**
 * @fileoverview ${req.context.filename}
 * @description Auto-documented by VoiceIDE
 * Voice command: "${req.transcript}"
 */`,
  }),
  unknown: (req) => ({
    intent: "unknown",
    insertMode: "append",
    explanation: `I heard: "${req.transcript}". Could you be more specific? Try: "generate a function that...", "refactor this to use...", or "explain this code".`,
    code: `// VoiceIDE: command "${req.transcript}" — unclear intent`,
  }),
};

export async function sendVoiceCommandWithFallback(
  request: VoiceCommandRequest,
  signal?: AbortSignal
): Promise<AICommandResponse & { usedMock?: boolean }> {
  try {
    const result = await sendVoiceCommand(request, signal);
    return result;
  } catch (err) {
    /* Network error or backend not running → use mock */
    if (err instanceof Error && err.name === "AbortError") throw err;

    const intent = classifyIntent(request.transcript);
    const mockFn = MOCK_RESPONSES[intent];
    return { ...mockFn(request), usedMock: true };
  }
}
