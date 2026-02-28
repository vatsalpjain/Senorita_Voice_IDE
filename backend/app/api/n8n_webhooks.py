"""
n8n Webhook Endpoints — Inbound Integration

These endpoints receive callbacks FROM n8n workflows.
n8n monitors email, extracts code requests, and calls these endpoints.
FastAPI processes with LLM and returns code snippets for n8n to send back.

Security: Validates webhook secret header and optionally checks source IP.
"""
import logging
import hmac
import hashlib
from typing import Any
from pydantic import BaseModel, Field
from fastapi import APIRouter, HTTPException, Header, Request, status
from app.config import settings
from app.services.groq_service import ask_llm

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/n8n", tags=["n8n-webhooks"])


# ─── Request/Response Models ────────────────────────────────────────────────


class EmailCodeRequest(BaseModel):
    """Payload from n8n when an email with code request is received"""
    email_id: str = Field(..., description="Unique email identifier from n8n")
    sender: str = Field(..., description="Email sender address")
    subject: str = Field(..., description="Email subject line")
    body: str = Field(..., description="Email body content with code request")
    attachments: list[str] = Field(default=[], description="List of attachment filenames")
    received_at: str = Field(..., description="ISO timestamp when email was received")


class CodeResponse(BaseModel):
    """Response sent back to n8n with generated code"""
    status: str = Field(..., description="success or error")
    code_snippet: str | None = Field(default=None, description="Generated code")
    explanation: str | None = Field(default=None, description="Brief explanation of the code")
    language: str | None = Field(default=None, description="Detected/used programming language")
    error: str | None = Field(default=None, description="Error message if failed")
    request_id: str = Field(..., description="Original request ID for tracking")


# ─── Security Helpers ───────────────────────────────────────────────────────


def verify_webhook_secret(provided_secret: str | None) -> bool:
    """
    Validates the webhook secret sent by n8n.
    n8n should include this in X-Webhook-Secret header.
    """
    if not settings.N8N_WEBHOOK_SECRET:
        # No secret configured — allow all (dev mode)
        logger.warning("N8N_WEBHOOK_SECRET not configured — skipping validation")
        return True
    
    if not provided_secret:
        return False
    
    # Constant-time comparison to prevent timing attacks
    return hmac.compare_digest(provided_secret, settings.N8N_WEBHOOK_SECRET)


def check_allowed_ip(request: Request) -> bool:
    """
    Checks if the request comes from an allowed IP.
    Useful for restricting n8n callbacks to known sources.
    """
    if not settings.N8N_ALLOWED_IPS:
        return True  # No IP restriction configured
    
    client_ip = request.client.host if request.client else None
    if not client_ip:
        return False
    
    # Check if client IP is in allowed list
    return client_ip in settings.N8N_ALLOWED_IPS


# ─── LLM Processing ─────────────────────────────────────────────────────────


async def process_code_request(request_text: str, context: str = "") -> dict:
    """
    Processes a code request using Groq LLM.
    Extracts the coding task and generates appropriate code.
    
    Returns dict with code_snippet, explanation, and language.
    """
    # System prompt optimized for code generation from email/Slack requests
    system_prompt = """You are Senorita, an expert AI coding assistant responding to code requests via email or Slack.

## Your Responsibilities:
1. **Carefully read and understand** what the user is asking for
2. **Generate complete, working code** that directly addresses their request
3. **Provide a detailed explanation** of what the code does and how to use it
4. **Answer any questions** they asked in their message

## Output Format:
1. First, briefly acknowledge what they asked for
2. Provide the code in a properly formatted code block with language identifier
3. After the code, explain:
   - What the code does (step by step if complex)
   - How to use it
   - Any dependencies or requirements
   - Potential improvements or alternatives

## Guidelines:
- Write clean, well-commented, production-ready code
- Use modern best practices for the language
- If the request mentions "check code" or "review code", provide a code review with suggestions
- If the request is about debugging, identify the issue and provide the fix
- If the request is unclear, provide your best interpretation AND ask clarifying questions
- Be helpful, thorough, and professional

## Example Response Structure:
Here's the [function/code] you requested for [task]:

[code block]

Explanation:
This code [does X, Y, Z]. To use it, [instructions]. 

Notes:
- Any important considerations
- Potential improvements"""

    try:
        response = await ask_llm(
            prompt=request_text,
            system_prompt=system_prompt,
            context=context if context else None,
            action="GENERATE_CODE",
            temperature=0.4,
            max_tokens=4096,
        )
        
        # Parse response to extract code and explanation
        code_snippet = ""
        explanation = ""
        language = "python"  # Default
        
        # Extract code block if present
        if "```" in response:
            parts = response.split("```")
            if len(parts) >= 2:
                code_part = parts[1]
                # First line might be language identifier
                lines = code_part.split("\n", 1)
                if lines[0].strip() and not lines[0].strip().startswith(("#", "/", "'")):
                    language = lines[0].strip()
                    code_snippet = lines[1] if len(lines) > 1 else ""
                else:
                    code_snippet = code_part
                code_snippet = code_snippet.strip()
                
                # Everything after the code block is explanation
                if len(parts) > 2:
                    explanation = "".join(parts[2:]).strip()
        else:
            # No code block — treat entire response as code
            code_snippet = response.strip()
            explanation = "Generated code based on your request."
        
        return {
            "code_snippet": code_snippet,
            "explanation": explanation or "Code generated successfully.",
            "language": language,
        }
        
    except Exception as e:
        logger.error(f"LLM processing error: {e}")
        return {
            "code_snippet": None,
            "explanation": None,
            "language": None,
            "error": str(e),
        }


# ─── Webhook Endpoints ──────────────────────────────────────────────────────


@router.post("/webhook/email", response_model=CodeResponse)
async def handle_email_webhook(
    request: Request,
    payload: EmailCodeRequest,
    x_webhook_secret: str | None = Header(default=None, alias="X-Webhook-Secret"),
) -> CodeResponse:
    """
    Receives email code requests from n8n.
    
    n8n workflow:
    1. IMAP Trigger monitors inbox for emails with subject containing "code" or similar
    2. Extracts email content
    3. Calls this endpoint with EmailCodeRequest payload
    4. Receives CodeResponse with generated code
    5. Sends reply email with the code snippet
    
    Headers:
        X-Webhook-Secret: Shared secret for authentication
    """
    # Security validation
    if not verify_webhook_secret(x_webhook_secret):
        logger.warning(f"Invalid webhook secret from {request.client.host}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid webhook secret"
        )
    
    if not check_allowed_ip(request):
        logger.warning(f"Request from disallowed IP: {request.client.host}")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="IP not allowed"
        )
    
    logger.info(f"Processing email code request from {payload.sender}: {payload.subject}")
    
    # Combine subject and body for context
    request_text = f"Subject: {payload.subject}\n\nRequest:\n{payload.body}"
    
    # Process with LLM
    result = await process_code_request(request_text)
    
    if result.get("error"):
        return CodeResponse(
            status="error",
            error=result["error"],
            request_id=payload.email_id,
        )
    
    return CodeResponse(
        status="success",
        code_snippet=result["code_snippet"],
        explanation=result["explanation"],
        language=result["language"],
        request_id=payload.email_id,
    )


@router.get("/health")
async def n8n_integration_health() -> dict:
    """
    Health check for n8n integration.
    Returns status of n8n connection and webhook configuration.
    """
    from app.services.n8n_service import check_n8n_health
    
    n8n_status = await check_n8n_health()
    
    return {
        "n8n_connection": n8n_status,
        "webhooks_configured": {
            "email": bool(settings.N8N_EMAIL_WEBHOOK_URL),
        },
        "security": {
            "webhook_secret_set": bool(settings.N8N_WEBHOOK_SECRET),
            "ip_restriction_enabled": bool(settings.N8N_ALLOWED_IPS),
        },
    }
