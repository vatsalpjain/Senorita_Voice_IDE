"""
Main Orchestrator — LangGraph-based state machine that routes voice commands
to the appropriate agents (Context, Coding, Debug, Workflow).

Flow:
1. Receive transcript + file context from frontend
2. Context Agent always runs first to gather enriched context
3. Detect intent from transcript (coding, debug, workflow, explain)
4. Route to appropriate agent
5. Return structured result for frontend to execute
"""
import logging
from typing import Literal, TypedDict, Any
from langgraph.graph import StateGraph, END

from app.agents.context_agent import get_context, FileContext
from app.agents.coding_agent import coding_agent, CodeAction
from app.agents.debug_agent import debug_agent, DebugResult
from app.agents.workflow_agent import workflow_agent, WorkflowResult
from app.services.groq_service import ask_llm

logger = logging.getLogger(__name__)


# Intent types that the orchestrator can route to
IntentType = Literal["coding", "debug", "workflow", "explain", "chat"]


class OrchestratorState(TypedDict):
    """State passed through the LangGraph workflow"""
    # Input from frontend
    transcript: str                     # User's voice command
    file_path: str                      # Current file path
    file_content: str                   # File content from editor (if available)
    cursor_line: int                    # Cursor position
    selection: str                      # Selected code
    project_root: str                   # Project root directory
    error_message: str                  # Error from terminal (for debug)
    mode: str                           # Explicit mode from UI ("auto" or specific)
    
    # Internal state
    context: FileContext | None         # Enriched context from Context Agent
    intent: IntentType | None           # Detected intent
    
    # Output
    result: dict | None                 # Result from the routed agent
    response_text: str                  # Text response for TTS
    error: str | None                   # Error message if something failed


# Intent detection keywords — maps phrases to intent types
INTENT_MAP = {
    # Coding intents
    "create": "coding",
    "write": "coding",
    "add": "coding",
    "implement": "coding",
    "refactor": "coding",
    "generate": "coding",
    "make": "coding",
    "build": "coding",
    "insert": "coding",
    "delete": "coding",
    "remove": "coding",
    "change": "coding",
    "modify": "coding",
    "update": "coding",
    
    # Debug intents
    "fix": "debug",
    "debug": "debug",
    "error": "debug",
    "bug": "debug",
    "why": "debug",
    "broken": "debug",
    "crash": "debug",
    "exception": "debug",
    "trace": "debug",
    "issue": "debug",
    
    # Explain/review intents
    "explain": "explain",
    "what does": "explain",
    "how does": "explain",
    "review": "explain",
    "understand": "explain",
    "tell me": "explain",
    "describe": "explain",
    
    # Workflow intents
    "email": "workflow",
    "notify": "workflow",
    "slack": "workflow",
    "github": "workflow",
    "remind": "workflow",
    "calendar": "workflow",
    "schedule": "workflow",
}


def detect_intent(transcript: str, explicit_mode: str = "auto") -> IntentType:
    """
    Detect user intent from transcript.
    Explicit mode from UI takes priority over auto-detection.
    """
    # If UI explicitly set a mode, use it
    if explicit_mode != "auto" and explicit_mode in ("coding", "debug", "workflow", "explain"):
        return explicit_mode
    
    transcript_lower = transcript.lower()
    
    # Check multi-word phrases first (more specific)
    multi_word_phrases = ["what does", "how does", "tell me", "create issue", "github issue"]
    for phrase in multi_word_phrases:
        if phrase in transcript_lower:
            return INTENT_MAP.get(phrase.split()[0], "chat")
    
    # Check single keywords
    for keyword, intent in INTENT_MAP.items():
        if keyword in transcript_lower:
            return intent
    
    # Default to chat for unrecognized commands
    return "chat"


# ─────────────────────────────────────────────────────────────────────────────
# LangGraph Node Functions
# ─────────────────────────────────────────────────────────────────────────────

async def gather_context_node(state: OrchestratorState) -> dict:
    """Node 1: Context Agent — always runs first to gather file context"""
    try:
        file_content = state.get("file_content", "")
        transcript = state.get("transcript", "")
        logger.info(f"gather_context_node: file_path={state['file_path']}, file_content_len={len(file_content)}")
        
        context = await get_context(
            file_path=state["file_path"],
            file_content=file_content,
            cursor_line=state["cursor_line"],
            selection=state["selection"],
            project_root=state.get("project_root"),
            transcript=transcript,  # Pass transcript for keyword-based symbol search
        )
        logger.info(
            f"gather_context_node: context current_file_len={len(context.get('current_file', ''))}, "
            f"relevant_snippets={len(context.get('relevant_snippets', []))}, "
            f"referenced_files={len(context.get('referenced_files', []))}"
        )
        return {"context": context}
    except Exception as e:
        logger.error(f"Context Agent failed: {e}")
        # Return minimal context on failure - use file_content from state
        file_content = state.get("file_content", "")
        return {
            "context": {
                "current_file": file_content,
                "file_path": state["file_path"],
                "language": "plaintext",
                "selected_code": state["selection"],
                "cursor_line": state["cursor_line"],
                "surrounding_lines": file_content[:2000] if file_content else "",
                "project_structure": "",
                "imports": [],
                "related_files": [],
                "symbols_in_file": [],
                "related_symbols": [],
                "symbol_at_cursor": None,
                "relevant_snippets": [],
                "project_summary": "",
                "referenced_files": [],
            }
        }


async def detect_intent_node(state: OrchestratorState) -> dict:
    """Node 2: Detect intent from transcript"""
    intent = detect_intent(state["transcript"], state.get("mode", "auto"))
    logger.info(f"Orchestrator: detected intent '{intent}' for '{state['transcript'][:50]}...'")
    return {"intent": intent}


async def coding_node(state: OrchestratorState) -> dict:
    """Node: Coding Agent — handles code generation/editing"""
    try:
        result = await coding_agent(state["transcript"], state["context"])
        response_text = result.get("explanation", "Code generated successfully.")
        return {
            "result": {"type": "code_action", "data": result},
            "response_text": response_text,
        }
    except Exception as e:
        logger.error(f"Coding Agent failed: {e}")
        return {
            "result": None,
            "response_text": "I had trouble generating the code. Please try again.",
            "error": str(e),
        }


async def debug_node(state: OrchestratorState) -> dict:
    """Node: Debug Agent — handles error analysis and bug fixing"""
    try:
        result = await debug_agent(
            state["transcript"],
            state["context"],
            state.get("error_message", ""),
        )
        
        # Build response text from debug result
        if result["bugs"]:
            bug_count = len(result["bugs"])
            response_text = f"Found {bug_count} issue{'s' if bug_count > 1 else ''}. {result['summary']}"
        else:
            response_text = "No bugs found. The code looks good."
        
        return {
            "result": {"type": "debug_result", "data": result},
            "response_text": response_text,
        }
    except Exception as e:
        logger.error(f"Debug Agent failed: {e}")
        return {
            "result": None,
            "response_text": "I had trouble analyzing the code. Please try again.",
            "error": str(e),
        }


async def workflow_node(state: OrchestratorState) -> dict:
    """Node: Workflow Agent — handles n8n triggers"""
    try:
        result = await workflow_agent(state["transcript"], state["context"])
        response_text = result["message"]
        return {
            "result": {"type": "workflow_result", "data": result},
            "response_text": response_text,
        }
    except Exception as e:
        logger.error(f"Workflow Agent failed: {e}")
        return {
            "result": None,
            "response_text": "I had trouble triggering the workflow. Please try again.",
            "error": str(e),
        }


async def explain_node(state: OrchestratorState) -> dict:
    """Node: Explain/Review — uses LLM to explain code with enhanced context"""
    try:
        context = state["context"]
        code_to_explain = context["selected_code"] or context["surrounding_lines"]
        
        # Build enhanced prompt with relevant snippets
        prompt_parts = []
        
        # Add project summary
        project_summary = context.get("project_summary", "")
        if project_summary:
            prompt_parts.append(f"**Project:** {project_summary}\n")
        
        # Add the code to explain
        prompt_parts.append(f"""**Code to explain** ({context['language']}):
```{context['language']}
{code_to_explain}
```
""")
        
        # Add symbol at cursor if available
        symbol_at_cursor = context.get("symbol_at_cursor")
        if symbol_at_cursor:
            prompt_parts.append(f"**Current symbol:** {symbol_at_cursor['kind']} `{symbol_at_cursor['name']}` - {symbol_at_cursor.get('signature', '')}\n")
        
        # Add relevant snippets from transcript search
        relevant_snippets = context.get("relevant_snippets", [])
        if relevant_snippets:
            prompt_parts.append("**Related code from project:**\n")
            for snippet in relevant_snippets[:3]:
                prompt_parts.append(f"From `{snippet['file_path']}` ({snippet['kind']} `{snippet['symbol_name']}`):")
                prompt_parts.append(f"```\n{snippet['code'][:600]}\n```\n")
        
        # Add referenced files (files mentioned by name in transcript)
        referenced_files = context.get("referenced_files", [])
        if referenced_files:
            prompt_parts.append("**Files mentioned in your question:**\n")
            for ref_file in referenced_files[:2]:  # Limit to 2 for explain
                prompt_parts.append(f"**{ref_file['filename']}**:")
                content_preview = ref_file.get('content', '')[:3000]
                if content_preview:
                    prompt_parts.append(f"```\n{content_preview}\n```\n")
        
        prompt_parts.append(f"**User asked:** {state['transcript']}")
        prompt_parts.append("\nProvide a clear, conversational explanation. Keep it concise — this will be spoken aloud.")
        
        prompt = "\n".join(prompt_parts)
        
        explanation = await ask_llm(
            prompt=prompt,
            system_prompt="""You are a code explainer with access to the full project context. 
When explaining code, reference related functions/classes from the project if relevant.
Be clear, concise, and conversational. Aim for 3-5 sentences.""",
            temperature=0.3,
            max_tokens=1024,
        )
        
        return {
            "result": {"type": "explanation", "data": {"text": explanation}},
            "response_text": explanation,
        }
    except Exception as e:
        logger.error(f"Explain node failed: {e}")
        return {
            "result": None,
            "response_text": "I had trouble explaining the code. Please try again.",
            "error": str(e),
        }


async def chat_node(state: OrchestratorState) -> dict:
    """Node: Chat — general conversation fallback with enhanced context"""
    try:
        context = state.get("context")
        file_content = context.get("current_file", "") if context else ""
        
        # Build enhanced prompt with file context AND relevant snippets
        prompt_parts = []
        
        # Add project summary if available
        project_summary = context.get("project_summary", "") if context else ""
        if project_summary:
            prompt_parts.append(f"**Project Overview:** {project_summary}\n")
        
        # Add current file context
        if file_content:
            prompt_parts.append(f"""**Current File** ({context.get('file_path', 'unknown')}):
```{context.get('language', 'plaintext')}
{file_content[:3000]}
```
""")
        
        # Add symbols in current file
        symbols_in_file = context.get("symbols_in_file", []) if context else []
        if symbols_in_file:
            symbol_list = ", ".join([f"{s['kind']} `{s['name']}`" for s in symbols_in_file[:15]])
            prompt_parts.append(f"**Symbols in this file:** {symbol_list}\n")
        
        # Add relevant code snippets from transcript search (THIS IS THE KEY ENHANCEMENT)
        relevant_snippets = context.get("relevant_snippets", []) if context else []
        if relevant_snippets:
            prompt_parts.append("**Relevant code from project (matching your query):**\n")
            for snippet in relevant_snippets[:5]:
                prompt_parts.append(f"From `{snippet['file_path']}` ({snippet['kind']} `{snippet['symbol_name']}` at line {snippet['line']}):")
                prompt_parts.append(f"```\n{snippet['code'][:800]}\n```\n")
        
        # Add referenced files (files mentioned by name in transcript)
        referenced_files = context.get("referenced_files", []) if context else []
        if referenced_files:
            prompt_parts.append("**Files mentioned in your question:**\n")
            for ref_file in referenced_files[:3]:  # Limit to 3 files
                prompt_parts.append(f"**{ref_file['filename']}** (`{ref_file['path']}`):")
                content_preview = ref_file.get('content', '')[:4000]
                if content_preview:
                    prompt_parts.append(f"```\n{content_preview}\n```\n")
        
        # Add the user's question
        prompt_parts.append(f"**User question:** {state['transcript']}")
        
        prompt = "\n".join(prompt_parts)
        
        response = await ask_llm(
            prompt=prompt,
            system_prompt="""You are Senorita, a helpful AI coding assistant. You have access to:
1. The user's current file
2. Symbols (functions, classes) in the file
3. Relevant code snippets from across the project that match the user's query

Use this context to answer questions about the codebase accurately. When referencing code, mention the file and function names.
Keep responses concise — this will be spoken aloud. Aim for 2-4 sentences unless more detail is needed.""",
            action="CHAT",
            temperature=0.5,
            max_tokens=800,
        )
        
        return {
            "result": {"type": "chat", "data": {"text": response}},
            "response_text": response,
        }
    except Exception as e:
        logger.error(f"Chat node failed: {e}")
        return {
            "result": None,
            "response_text": "I had trouble responding. Please try again.",
            "error": str(e),
        }


def route_by_intent(state: OrchestratorState) -> str:
    """Routing function — determines which agent node to call based on intent"""
    intent = state.get("intent", "chat")
    
    if intent == "coding":
        return "coding"
    elif intent == "debug":
        return "debug"
    elif intent == "workflow":
        return "workflow"
    elif intent == "explain":
        return "explain"
    else:
        return "chat"


# ─────────────────────────────────────────────────────────────────────────────
# Build the LangGraph Workflow
# ─────────────────────────────────────────────────────────────────────────────

def build_orchestrator_graph() -> StateGraph:
    """
    Build the LangGraph state machine for the orchestrator.
    
    Flow:
    START → gather_context → detect_intent → [route] → agent_node → END
    """
    # Create the graph with our state type
    graph = StateGraph(OrchestratorState)
    
    # Add nodes
    graph.add_node("gather_context", gather_context_node)
    graph.add_node("detect_intent", detect_intent_node)
    graph.add_node("coding", coding_node)
    graph.add_node("debug", debug_node)
    graph.add_node("workflow", workflow_node)
    graph.add_node("explain", explain_node)
    graph.add_node("chat", chat_node)
    
    # Set entry point
    graph.set_entry_point("gather_context")
    
    # Add edges
    graph.add_edge("gather_context", "detect_intent")
    
    # Conditional routing based on intent
    graph.add_conditional_edges(
        "detect_intent",
        route_by_intent,
        {
            "coding": "coding",
            "debug": "debug",
            "workflow": "workflow",
            "explain": "explain",
            "chat": "chat",
        }
    )
    
    # All agent nodes go to END
    graph.add_edge("coding", END)
    graph.add_edge("debug", END)
    graph.add_edge("workflow", END)
    graph.add_edge("explain", END)
    graph.add_edge("chat", END)
    
    return graph


# Compile the graph once at module load
_orchestrator_graph = build_orchestrator_graph()
_compiled_orchestrator = _orchestrator_graph.compile()


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────

async def orchestrate(
    transcript: str,
    file_path: str,
    file_content: str = "",
    cursor_line: int = 1,
    selection: str = "",
    project_root: str | None = None,
    error_message: str = "",
    mode: str = "auto",
) -> dict:
    """
    Main entry point for the orchestrator.
    Routes voice commands through the LangGraph workflow.
    
    Args:
        transcript: User's voice command
        file_path: Absolute path to current file
        cursor_line: 1-indexed cursor position
        selection: Selected code snippet
        project_root: Project root directory
        error_message: Error from terminal (for debug mode)
        mode: Explicit mode ("auto", "coding", "debug", "workflow", "explain")
    
    Returns:
        dict with:
            - intent: detected intent type
            - result: agent-specific result (code_action, debug_result, etc.)
            - response_text: text for TTS
            - error: error message if failed
    """
    # Build initial state
    initial_state: OrchestratorState = {
        "transcript": transcript,
        "file_path": file_path,
        "file_content": file_content,
        "cursor_line": cursor_line,
        "selection": selection,
        "project_root": project_root or "",
        "error_message": error_message,
        "mode": mode,
        "context": None,
        "intent": None,
        "result": None,
        "response_text": "",
        "error": None,
    }
    
    # Run the graph
    try:
        final_state = await _compiled_orchestrator.ainvoke(initial_state)
        
        return {
            "intent": final_state.get("intent", "chat"),
            "result": final_state.get("result"),
            "response_text": final_state.get("response_text", ""),
            "error": final_state.get("error"),
        }
    except Exception as e:
        logger.error(f"Orchestrator failed: {e}")
        return {
            "intent": "error",
            "result": None,
            "response_text": "Something went wrong. Please try again.",
            "error": str(e),
        }
