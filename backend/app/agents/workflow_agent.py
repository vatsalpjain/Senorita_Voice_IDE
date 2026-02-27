"""
Workflow Agent — Handles external workflow triggers via n8n.
Supports: email summaries, GitHub issues, Slack notifications, reminders, etc.
Currently a placeholder — n8n webhooks not configured yet.
"""
import logging
from typing import Literal, TypedDict
from app.services.groq_service import ask_llm
from app.agents.context_agent import FileContext

logger = logging.getLogger(__name__)


class WorkflowResult(TypedDict):
    """Structured result from the Workflow Agent"""
    workflow: str                       # Which workflow was triggered
    status: Literal["triggered", "not_configured", "error"]
    message: str                        # User-friendly status message
    payload: dict                       # Data sent to the workflow


# Mapping of keywords to workflow types
WORKFLOW_TRIGGERS = {
    "email": "send-summary",
    "mail": "send-summary",
    "send summary": "send-summary",
    "github issue": "create-issue",
    "create issue": "create-issue",
    "bug report": "create-issue",
    "slack": "notify-slack",
    "notify team": "notify-slack",
    "notify": "notify-slack",
    "notion": "log-notion",
    "log": "log-notion",
    "remind": "set-reminder",
    "reminder": "set-reminder",
    "calendar": "set-reminder",
    "schedule": "set-reminder",
}


def detect_workflow(transcript: str) -> str | None:
    """Detect which workflow to trigger based on transcript keywords"""
    transcript_lower = transcript.lower()
    
    # Check multi-word phrases first (more specific)
    for phrase in ["send summary", "github issue", "create issue", "bug report", "notify team"]:
        if phrase in transcript_lower:
            return WORKFLOW_TRIGGERS[phrase]
    
    # Then check single keywords
    for keyword, workflow in WORKFLOW_TRIGGERS.items():
        if keyword in transcript_lower:
            return workflow
    
    return None


async def summarize_for_workflow(context: FileContext) -> str:
    """
    Generate a concise summary of the current code context for workflow payloads.
    Used when sending emails, creating issues, etc.
    """
    # Truncate file content for summary
    file_content = context["current_file"]
    if len(file_content) > 2000:
        file_content = file_content[:2000] + "... (truncated)"
    
    prompt = f"""Summarize this code context in 2-3 sentences for a workflow notification:

File: {context['file_path']}
Language: {context['language']}

Code:
{file_content}

Focus on: what the code does, any notable patterns, and current state."""
    
    summary = await ask_llm(
        prompt=prompt,
        system_prompt="You are a code summarizer. Be concise and technical.",
        temperature=0.3,
        max_tokens=256,
    )
    
    return summary


async def workflow_agent(
    transcript: str,
    context: FileContext,
) -> WorkflowResult:
    """
    Main entry point for the Workflow Agent.
    Detects workflow type and prepares payload for n8n trigger.
    
    Args:
        transcript: User's voice command (e.g., "email me a summary", "create github issue")
        context: FileContext from Context Agent
    
    Returns:
        WorkflowResult with workflow type, status, and payload
    
    Note: Actual n8n triggering is NOT implemented yet.
    This agent prepares the payload; integration with n8n_service comes later.
    """
    # Detect which workflow to trigger
    workflow = detect_workflow(transcript)
    
    if not workflow:
        logger.warning(f"Workflow Agent: no workflow detected for '{transcript}'")
        return {
            "workflow": "unknown",
            "status": "error",
            "message": "I couldn't determine which workflow to trigger. Try saying 'email summary' or 'create github issue'.",
            "payload": {},
        }
    
    # Generate summary for the payload
    summary = await summarize_for_workflow(context)
    
    # Build the payload
    payload = {
        "trigger": transcript,
        "workflow": workflow,
        "file_path": context["file_path"],
        "language": context["language"],
        "summary": summary,
        "code_snippet": context["selected_code"] or context["surrounding_lines"][:500],
    }
    
    # For now, return not_configured since n8n webhooks aren't set up
    # When n8n is configured, this will call trigger_n8n() from n8n_service
    logger.info(f"Workflow Agent: prepared '{workflow}' workflow (not configured)")
    
    return {
        "workflow": workflow,
        "status": "not_configured",
        "message": f"Workflow '{workflow}' is ready but n8n is not configured yet.",
        "payload": payload,
    }


async def trigger_workflow(workflow: str, payload: dict) -> WorkflowResult:
    """
    Actually trigger the n8n workflow.
    Placeholder — will integrate with n8n_service when webhooks are configured.
    
    Args:
        workflow: Workflow identifier (e.g., "send-summary", "create-issue")
        payload: Data to send to the workflow
    
    Returns:
        WorkflowResult with trigger status
    """
    # TODO: Integrate with app.services.n8n_service.trigger_n8n()
    # For now, return placeholder response
    
    logger.info(f"Workflow Agent: would trigger '{workflow}' with payload")
    
    return {
        "workflow": workflow,
        "status": "not_configured",
        "message": f"n8n webhook for '{workflow}' is not configured. Set up webhooks in .env to enable.",
        "payload": payload,
    }
