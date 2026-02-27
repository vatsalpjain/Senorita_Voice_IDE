import logging
import httpx
from app.config import settings

logger = logging.getLogger(__name__)

WEBHOOK_MAP = {
    "N8N_EMAIL":  "N8N_EMAIL_WEBHOOK_URL",
    "N8N_GITHUB": "N8N_GITHUB_WEBHOOK_URL",
    "N8N_SLACK":  "N8N_SLACK_WEBHOOK_URL",
}

async def trigger_n8n(action: str, payload: dict) -> dict:
    url_field = WEBHOOK_MAP.get(action)
    if not url_field:
        return {"status": "error", "detail": f"Unknown n8n action: {action}"}

    url = getattr(settings, url_field, "")
    if not url:
        logger.warning(f"n8n webhook not configured for {action}")
        return {"status": "not_configured", "action": action}

    full_payload = {**payload, "action": action, "source": "senorita-voice"}

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(url, json=full_payload)
            resp.raise_for_status()
            return {"status": "triggered", "action": action}
    except httpx.HTTPStatusError as e:
        logger.error(f"n8n webhook error: {e.response.status_code}")
        return {"status": "error", "detail": str(e)}
    except Exception as e:
        logger.error(f"n8n unexpected error: {e}")
        return {"status": "error", "detail": str(e)}
