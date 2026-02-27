"""
Debug Agent — Analyzes code for bugs, parses error messages/stacktraces,
identifies root causes, and suggests fixes with line-specific information.
Returns structured debug info for frontend to display (decorations, highlights).
"""
import json
import logging
import re
from typing import Literal, TypedDict
from app.services.groq_service import ask_llm
from app.agents.context_agent import FileContext

logger = logging.getLogger(__name__)


class BugInfo(TypedDict):
    """Information about a detected bug"""
    bug_line: int                       # Line number where bug is located
    bug_description: str                # What the bug is
    severity: Literal["error", "warning", "suggestion"]
    fix_code: str                       # Corrected code snippet
    explanation: str                    # Why this is a bug and how fix works


class DebugResult(TypedDict):
    """Structured result from the Debug Agent"""
    bugs: list[BugInfo]                 # List of detected bugs
    summary: str                        # Overall summary of issues found
    has_critical: bool                  # Whether any critical errors exist
    suggested_action: str               # What the user should do next


# System prompt for the Debug Agent
DEBUG_AGENT_SYSTEM_PROMPT = """You are a Debug Agent for Senorita, a voice-powered AI IDE assistant.
Your job is to analyze code for bugs, parse error messages, identify root causes, and suggest fixes.

IMPORTANT: You must ALWAYS respond with valid JSON in this exact format:
{
  "bugs": [
    {
      "bug_line": 42,
      "bug_description": "Brief description of the bug",
      "severity": "error" | "warning" | "suggestion",
      "fix_code": "the corrected code for this line/block",
      "explanation": "Why this is a bug and how the fix works"
    }
  ],
  "summary": "Overall summary of issues found",
  "has_critical": true | false,
  "suggested_action": "What the user should do next"
}

Severity levels:
- "error": Will cause crash, exception, or incorrect behavior
- "warning": Potential issue, bad practice, or edge case not handled
- "suggestion": Code improvement, optimization, or style fix

Guidelines:
- Be precise about line numbers — use the line numbers from the code context
- Provide minimal fix_code — only the lines that need to change
- Keep explanations concise (will be spoken aloud)
- If analyzing an error message, trace it back to the source line
- Look for common bugs: null/undefined, off-by-one, type mismatches, missing imports
- If no bugs found, return empty bugs array with appropriate summary

RESPOND ONLY WITH THE JSON OBJECT. NO MARKDOWN, NO EXTRA TEXT."""


def parse_error_message(error_msg: str) -> dict:
    """
    Parse common error message formats to extract useful info.
    Supports Python, JavaScript, TypeScript, Java stacktraces.
    """
    info = {
        "error_type": None,
        "error_text": error_msg,
        "line_number": None,
        "file_path": None,
        "stacktrace_lines": [],
    }
    
    # Python traceback: File "path", line N
    python_match = re.search(r'File "([^"]+)", line (\d+)', error_msg)
    if python_match:
        info["file_path"] = python_match.group(1)
        info["line_number"] = int(python_match.group(2))
    
    # Python error type: ErrorType: message
    error_type_match = re.search(r'^(\w+Error|\w+Exception):\s*(.+)$', error_msg, re.MULTILINE)
    if error_type_match:
        info["error_type"] = error_type_match.group(1)
        info["error_text"] = error_type_match.group(2)
    
    # JavaScript/Node: at file:line:col or (file:line:col)
    js_match = re.search(r'(?:at\s+)?(?:\()?([^\s()]+):(\d+):\d+(?:\))?', error_msg)
    if js_match and not info["line_number"]:
        info["file_path"] = js_match.group(1)
        info["line_number"] = int(js_match.group(2))
    
    # TypeScript: file.ts(line,col)
    ts_match = re.search(r'([^\s]+\.tsx?)\((\d+),\d+\)', error_msg)
    if ts_match:
        info["file_path"] = ts_match.group(1)
        info["line_number"] = int(ts_match.group(2))
    
    # Java: at package.Class.method(File.java:line)
    java_match = re.search(r'at\s+[\w.]+\((\w+\.java):(\d+)\)', error_msg)
    if java_match:
        info["file_path"] = java_match.group(1)
        info["line_number"] = int(java_match.group(2))
    
    # Extract all stacktrace lines for context
    stacktrace_pattern = r'^\s*(?:at\s+|File\s+"|Traceback).+'
    info["stacktrace_lines"] = re.findall(stacktrace_pattern, error_msg, re.MULTILINE)[:10]
    
    return info


async def debug_agent(
    transcript: str,
    context: FileContext,
    error_message: str = "",
) -> DebugResult:
    """
    Main entry point for the Debug Agent.
    Analyzes code and/or error messages to find and fix bugs.
    
    Args:
        transcript: User's voice command (e.g., "debug this error", "find the bug")
        context: FileContext from Context Agent
        error_message: Optional error message/stacktrace from terminal or console
    
    Returns:
        DebugResult with list of bugs, fixes, and recommendations
    """
    # Parse error message if provided
    error_info = parse_error_message(error_message) if error_message else None
    
    # Build the prompt with all context
    prompt = _build_debug_prompt(transcript, context, error_message, error_info)
    
    # Call LLM with debug-specific system prompt
    response = await ask_llm(
        prompt=prompt,
        system_prompt=DEBUG_AGENT_SYSTEM_PROMPT,
        temperature=0.1,  # Very low temperature for precise analysis
        max_tokens=4096,
    )
    
    # Parse the JSON response
    result = _parse_debug_response(response)
    
    logger.info(f"Debug Agent: found {len(result['bugs'])} issues, critical={result['has_critical']}")
    return result


def _build_debug_prompt(
    transcript: str,
    context: FileContext,
    error_message: str,
    error_info: dict | None,
) -> str:
    """Build a detailed prompt for debugging analysis"""
    
    prompt_parts = [
        f"Language: {context['language']}",
        f"File: {context['file_path']}",
    ]
    
    # Add error information if available
    if error_message:
        prompt_parts.append(f"\n=== ERROR MESSAGE ===\n{error_message}")
        
        if error_info and error_info.get("line_number"):
            prompt_parts.append(f"\nParsed error location: line {error_info['line_number']}")
        if error_info and error_info.get("error_type"):
            prompt_parts.append(f"Error type: {error_info['error_type']}")
    
    # Add selected code if user selected something
    if context["selected_code"]:
        prompt_parts.append(f"\n=== SELECTED CODE (user wants to debug this) ===\n{context['selected_code']}")
    
    # Add surrounding lines with line numbers
    prompt_parts.append(f"\n=== CODE CONTEXT ===\n{context['surrounding_lines']}")
    
    # Add full file if not too long (for import/dependency analysis)
    file_lines = context["current_file"].splitlines()
    if len(file_lines) <= 150:
        prompt_parts.append(f"\n=== FULL FILE ===\n{context['current_file']}")
    else:
        # Just add first 50 lines (imports) and relevant section
        header = "\n".join(file_lines[:50])
        prompt_parts.append(f"\n=== FILE HEADER (imports) ===\n{header}")
    
    # Add user's command
    prompt_parts.append(f"\n=== USER COMMAND ===\n{transcript}")
    
    # Add specific instructions based on what we have
    if error_message:
        prompt_parts.append("\nTask: Analyze the error message, trace it to the source, and provide a fix.")
    elif context["selected_code"]:
        prompt_parts.append("\nTask: Analyze the selected code for bugs, issues, or improvements.")
    else:
        prompt_parts.append("\nTask: Review the code around the cursor for potential bugs or issues.")
    
    return "\n".join(prompt_parts)


def _parse_debug_response(response: str) -> DebugResult:
    """Parse LLM response into structured DebugResult"""
    
    # Try to extract JSON from response
    json_str = response.strip()
    
    # Remove markdown code blocks if present
    if json_str.startswith("```"):
        match = re.search(r"```(?:json)?\s*\n?(.*?)\n?```", json_str, re.DOTALL)
        if match:
            json_str = match.group(1).strip()
    
    try:
        data = json.loads(json_str)
    except json.JSONDecodeError as e:
        logger.warning(f"Failed to parse Debug Agent response as JSON: {e}")
        # Fallback: return the response as a summary
        return {
            "bugs": [],
            "summary": response[:500],
            "has_critical": False,
            "suggested_action": "Review the analysis above and check manually.",
        }
    
    # Validate and normalize bugs
    bugs = []
    for bug in data.get("bugs", []):
        severity = bug.get("severity", "warning")
        if severity not in ("error", "warning", "suggestion"):
            severity = "warning"
        
        bugs.append({
            "bug_line": bug.get("bug_line", 1),
            "bug_description": bug.get("bug_description", "Unknown issue"),
            "severity": severity,
            "fix_code": bug.get("fix_code", ""),
            "explanation": bug.get("explanation", ""),
        })
    
    # Check for critical errors
    has_critical = any(b["severity"] == "error" for b in bugs)
    
    return {
        "bugs": bugs,
        "summary": data.get("summary", f"Found {len(bugs)} issue(s)"),
        "has_critical": has_critical,
        "suggested_action": data.get("suggested_action", "Review and apply the suggested fixes."),
    }


async def quick_error_analysis(error_message: str, code_snippet: str = "") -> str:
    """
    Quick error analysis without full file context.
    Used for terminal errors or quick debugging.
    Returns a plain text explanation.
    """
    prompt = f"""Analyze this error and explain the cause and fix:

Error:
{error_message}

{"Code:" + chr(10) + code_snippet if code_snippet else ""}

Provide a brief, clear explanation of:
1. What caused this error
2. How to fix it

Keep it concise — this will be spoken aloud."""
    
    response = await ask_llm(
        prompt=prompt,
        system_prompt="You are a debugging expert. Explain errors clearly and concisely.",
        temperature=0.2,
        max_tokens=1024,
    )
    
    return response
