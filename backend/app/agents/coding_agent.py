"""
Coding Agent — Handles code generation, insertion, editing, and refactoring.
Returns JSON instructions for the frontend (Monaco) to execute.
Does NOT write files directly — frontend handles actual file mutations.
"""
import json
import logging
import re
from typing import Literal, TypedDict
from app.services.groq_service import ask_llm
from app.agents.context_agent import FileContext

logger = logging.getLogger(__name__)


class SingleEdit(TypedDict):
    """A single edit to a specific file"""
    file_path: str                      # Path to the file to edit
    action: Literal["insert", "replace_selection", "replace_file", "create_file", "delete_lines"]
    code: str                           # The code to insert/replace
    insert_at_line: int | None          # Only for insert action
    start_line: int | None              # For delete_lines or replace range
    end_line: int | None                # For delete_lines or replace range


class CodeAction(TypedDict):
    """Structured code action returned by the Coding Agent — supports multi-file edits"""
    edits: list[SingleEdit]             # List of edits (can be single or multiple files)
    explanation: str                    # Brief explanation of what was done


# System prompt for the Coding Agent — instructs LLM to return structured JSON
CODING_AGENT_SYSTEM_PROMPT = """You are a Coding Agent for Senorita, a voice-powered AI IDE assistant.
Your job is to generate, insert, edit, or refactor code based on the user's voice command.

IMPORTANT: You must ALWAYS respond with valid JSON in this exact format:
{
  "edits": [
    {
      "file_path": "path/to/file.py",
      "action": "insert" | "replace_selection" | "replace_file" | "create_file" | "delete_lines",
      "code": "the code to insert or replace with",
      "insert_at_line": 12,  // only if action is insert
      "start_line": 5,       // only for delete_lines or range replace
      "end_line": 10         // only for delete_lines or range replace
    }
  ],
  "explanation": "brief explanation of what you did"
}

For SINGLE FILE edits, use the current file path provided in context.
For MULTI-FILE edits (e.g., adding import + function), include multiple entries in "edits" array.

Action types:
- "insert": Insert new code at a specific line (use insert_at_line)
- "replace_selection": Replace the user's selected code with new code
- "replace_file": Replace the entire file content
- "create_file": Create a new file (file_path is the new file path)
- "delete_lines": Delete lines from start_line to end_line

Guidelines:
- Generate clean, well-commented, production-ready code
- Match the existing code style in the file
- Use the language detected from the file context
- If adding a function, place it logically (after imports, before main, etc.)
- For refactoring, preserve functionality while improving structure
- Keep explanations concise (will be spoken aloud)
- When creating related changes (e.g., new file + import), include ALL edits

RESPOND ONLY WITH THE JSON OBJECT. NO MARKDOWN, NO EXTRA TEXT."""


async def coding_agent(
    transcript: str,
    context: FileContext,
) -> CodeAction:
    """
    Main entry point for the Coding Agent.
    Takes user's voice command and file context, returns structured code action.
    
    Args:
        transcript: User's voice command (e.g., "create a function to sort a list")
        context: FileContext from Context Agent
    
    Returns:
        CodeAction dict with action type and code to apply
    """
    # Build the prompt with all relevant context
    prompt = _build_coding_prompt(transcript, context)
    
    # Call LLM with coding-specific system prompt
    response = await ask_llm(
        prompt=prompt,
        system_prompt=CODING_AGENT_SYSTEM_PROMPT,
        temperature=0.2,  # Lower temperature for more deterministic code
        max_tokens=4096,  # Allow longer code responses
    )
    
    # Parse the JSON response
    action = _parse_coding_response(response, context)
    
    edit_count = len(action["edits"])
    logger.info(f"Coding Agent: {edit_count} edit(s) - {action['explanation'][:50]}...")
    return action


def _build_coding_prompt(transcript: str, context: FileContext) -> str:
    """Build a detailed prompt for the LLM with all context"""
    
    # Truncate file content if too long (keep first 200 lines)
    file_content = context["current_file"]
    lines = file_content.splitlines()
    if len(lines) > 200:
        file_content = "\n".join(lines[:200]) + f"\n... ({len(lines) - 200} more lines)"
    
    prompt_parts = [
        f"Language: {context['language']}",
        f"File: {context['file_path']}",
        f"Cursor at line: {context['cursor_line']}",
    ]
    
    # Add selected code if present
    if context["selected_code"]:
        prompt_parts.append(f"\nSelected code:\n```\n{context['selected_code']}\n```")
    
    # Add surrounding lines for local context
    prompt_parts.append(f"\nCode around cursor:\n{context['surrounding_lines']}")
    
    # Add imports for reference
    if context["imports"]:
        prompt_parts.append(f"\nExisting imports:\n" + "\n".join(context["imports"][:10]))
    
    # Add the user's command
    prompt_parts.append(f"\nUser command: {transcript}")
    
    # Add instruction based on detected intent
    if "refactor" in transcript.lower():
        prompt_parts.append("\nTask: Refactor the code while preserving functionality.")
    elif "add" in transcript.lower() or "create" in transcript.lower():
        prompt_parts.append("\nTask: Generate new code and insert it at the appropriate location.")
    elif "fix" in transcript.lower() or "change" in transcript.lower():
        prompt_parts.append("\nTask: Modify the existing code as requested.")
    elif "delete" in transcript.lower() or "remove" in transcript.lower():
        prompt_parts.append("\nTask: Identify and remove the specified code.")
    else:
        prompt_parts.append("\nTask: Generate or modify code based on the command.")
    
    return "\n".join(prompt_parts)


def _parse_coding_response(response: str, context: FileContext) -> CodeAction:
    """Parse LLM response into structured CodeAction with multi-file support"""
    
    # Try to extract JSON from response (handle markdown code blocks)
    json_str = response.strip()
    
    # Remove markdown code blocks if present
    if json_str.startswith("```"):
        match = re.search(r"```(?:json)?\s*\n?(.*?)\n?```", json_str, re.DOTALL)
        if match:
            json_str = match.group(1).strip()
    
    try:
        data = json.loads(json_str)
    except json.JSONDecodeError as e:
        logger.warning(f"Failed to parse Coding Agent response as JSON: {e}")
        # Fallback: treat entire response as code to insert at current file
        return {
            "edits": [{
                "file_path": context["file_path"],
                "action": "insert",
                "code": response,
                "insert_at_line": context["cursor_line"],
                "start_line": None,
                "end_line": None,
            }],
            "explanation": "Generated code (JSON parse failed, inserting raw response)",
        }
    
    # Handle new multi-file format
    if "edits" in data and isinstance(data["edits"], list):
        edits = []
        for edit in data["edits"]:
            action = edit.get("action", "insert")
            if action not in ("insert", "replace_selection", "replace_file", "create_file", "delete_lines"):
                action = "insert"
            edits.append({
                "file_path": edit.get("file_path", context["file_path"]),
                "action": action,
                "code": edit.get("code", ""),
                "insert_at_line": edit.get("insert_at_line"),
                "start_line": edit.get("start_line"),
                "end_line": edit.get("end_line"),
            })
        return {
            "edits": edits,
            "explanation": data.get("explanation", "Code generated"),
        }
    
    # Handle legacy single-edit format for backwards compatibility
    action = data.get("action", "insert")
    if action not in ("insert", "replace_selection", "replace_file", "create_file", "delete_lines"):
        action = "insert"
    
    return {
        "edits": [{
            "file_path": data.get("filename") or context["file_path"],
            "action": action,
            "code": data.get("code", ""),
            "insert_at_line": data.get("insert_at_line"),
            "start_line": data.get("start_line"),
            "end_line": data.get("end_line"),
        }],
        "explanation": data.get("explanation", "Code generated"),
    }


async def generate_code_only(
    transcript: str,
    language: str = "python",
) -> str:
    """
    Simplified code generation without file context.
    Used when no file is open or for standalone code snippets.
    
    Returns just the code string, not a full CodeAction.
    """
    prompt = f"""Generate {language} code for the following request:
{transcript}

Return ONLY the code, no explanations, no markdown code blocks."""
    
    response = await ask_llm(
        prompt=prompt,
        system_prompt="You are a code generator. Output clean, production-ready code only.",
        temperature=0.2,
        max_tokens=2048,
    )
    
    # Strip any accidental markdown
    code = response.strip()
    if code.startswith("```"):
        match = re.search(r"```(?:\w+)?\s*\n?(.*?)\n?```", code, re.DOTALL)
        if match:
            code = match.group(1).strip()
    
    return code
