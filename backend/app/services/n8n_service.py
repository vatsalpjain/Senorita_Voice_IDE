"""
n8n Webhook Service — Bidirectional Integration

Handles two-way communication between FastAPI and n8n:
1. Outbound: FastAPI triggers n8n workflows via webhook URLs
2. Inbound: n8n calls FastAPI endpoints with processed data (handled in n8n_webhooks.py)

n8n runs on Docker at localhost:5678 — ensure CORS and network settings allow communication.
"""
import logging
from typing import Any
from enum import Enum
from pydantic import BaseModel
import httpx
from app.config import settings

logger = logging.getLogger(__name__)


class N8nWorkflowType(str, Enum):
    """Supported n8n workflow types for Senorita integration"""
    EMAIL_MONITOR = "email_monitor"  # monitors inbox, sends code requests to FastAPI
    EMAIL_REPLY = "email_reply"  # sends code snippet reply via email
    EMAIL_SEND = "email_send"  # sends outbound email (voice command triggered)


class N8nPayload(BaseModel):
    """Base payload structure for n8n webhook calls"""
    action: str
    source: str = "senorita-voice"
    workflow_type: str | None = None
    data: dict[str, Any] = {}


# Maps action names to their corresponding webhook URL settings
WEBHOOK_MAP = {
    "N8N_EMAIL": "N8N_EMAIL_WEBHOOK_URL",
}


def get_n8n_base_url() -> str:
    """Returns the configured n8n base URL — used for health checks and API calls"""
    return settings.N8N_BASE_URL.rstrip("/")


async def check_n8n_health() -> dict:
    """
    Checks if n8n instance is reachable.
    Useful for status endpoint and startup validation.
    """
    base_url = get_n8n_base_url()
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            # n8n health endpoint
            resp = await client.get(f"{base_url}/healthz")
            if resp.status_code == 200:
                return {"status": "healthy", "url": base_url}
            return {"status": "unhealthy", "code": resp.status_code}
    except httpx.ConnectError:
        logger.warning(f"n8n not reachable at {base_url}")
        return {"status": "unreachable", "url": base_url}
    except Exception as e:
        logger.error(f"n8n health check error: {e}")
        return {"status": "error", "detail": str(e)}


async def trigger_n8n(action: str, payload: dict) -> dict:
    """
    Triggers an n8n workflow via its webhook URL.
    
    Args:
        action: One of N8N_EMAIL, N8N_GITHUB, N8N_SLACK
        payload: Data to send to the workflow
        
    Returns:
        dict with status and any response data from n8n
    """
    url_field = WEBHOOK_MAP.get(action)
    if not url_field:
        return {"status": "error", "detail": f"Unknown n8n action: {action}"}

    url = getattr(settings, url_field, "")
    if not url:
        logger.warning(f"n8n webhook not configured for {action}")
        return {"status": "not_configured", "action": action}

    # Build standardized payload with metadata
    full_payload = N8nPayload(
        action=action,
        source="senorita-voice",
        workflow_type=action.lower().replace("n8n_", ""),
        data=payload
    ).model_dump()

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(url, json=full_payload)
            resp.raise_for_status()
            
            # n8n webhook can return data — capture it
            response_data = {}
            try:
                response_data = resp.json()
            except Exception:
                pass  # n8n may return empty or non-JSON response
                
            return {
                "status": "triggered",
                "action": action,
                "n8n_response": response_data
            }
    except httpx.HTTPStatusError as e:
        logger.error(f"n8n webhook HTTP error: {e.response.status_code}")
        return {"status": "error", "code": e.response.status_code, "detail": str(e)}
    except httpx.ConnectError:
        logger.error(f"n8n webhook connection failed for {action}")
        return {"status": "connection_error", "action": action}
    except Exception as e:
        logger.error(f"n8n unexpected error: {e}")
        return {"status": "error", "detail": str(e)}


async def trigger_email_workflow(
    subject: str,
    body: str,
    recipient: str | None = None,
    code_context: str | None = None,
) -> dict:
    """
    Triggers the email workflow in n8n.
    Used when user says "email summary" or similar voice command.
    
    Args:
        subject: Email subject line
        body: Email body content (can include code snippets)
        recipient: Optional recipient email
        code_context: Optional code context from current file
    """
    payload = {
        "subject": subject,
        "body": body,
        "recipient": recipient,
        "code_context": code_context,
        "timestamp": __import__("datetime").datetime.utcnow().isoformat(),
    }
    return await trigger_n8n("N8N_EMAIL", payload)


