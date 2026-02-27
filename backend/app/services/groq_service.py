import logging
from typing import AsyncGenerator
from groq import AsyncGroq
from app.config import settings

logger = logging.getLogger(__name__)

_groq_client: AsyncGroq | None = None

def get_groq_client() -> AsyncGroq:
    """Returns the async Groq client singleton"""
    global _groq_client
    if _groq_client is None:
        _groq_client = AsyncGroq(api_key=settings.GROQ_API_KEY)
    return _groq_client

DEFAULT_SYSTEM_PROMPT = """You are Senorita, a voice-powered AI coding assistant.
You help developers write, debug, review, and understand code through natural voice commands.
Be concise — your responses will be converted to audio. Avoid markdown unless writing code blocks.
When generating code, output clean, well-commented code."""

ACTION_SYSTEM_PROMPTS = {
    "GENERATE_CODE": "Generate the requested code. Output only the code and a brief explanation.",
    "DEBUG_MODE":    "Analyze the code for bugs. Explain each issue clearly and provide the fix.",
    "REVIEW_MODE":   "Review the code for quality, performance, and best practices.",
    "EXPLAIN_CODE":  "Explain the code clearly as if talking to a developer. Be conversational.",
}

async def ask_llm(
    prompt: str,
    system_prompt: str | None = None,
    context: str | None = None,
    action: str = "GENERATE_CODE",
    temperature: float = 0.3,
    max_tokens: int = 2048,
) -> str:
    """Single-turn LLM call. Returns complete response string."""
    client = get_groq_client()
    sys = system_prompt or (
        DEFAULT_SYSTEM_PROMPT + "\n" + ACTION_SYSTEM_PROMPTS.get(action, "")
    )
    user_content = f"Context:\n```\n{context}\n```\n\n{prompt}" if context else prompt

    response = await client.chat.completions.create(
        model=settings.GROQ_MODEL,   # always "llama-3.3-70b-versatile"
        messages=[
            {"role": "system", "content": sys},
            {"role": "user",   "content": user_content},
        ],
        temperature=temperature,
        max_tokens=max_tokens,
    )
    return response.choices[0].message.content

async def stream_llm(
    prompt: str,
    system_prompt: str | None = None,
    context: str | None = None,
    action: str = "GENERATE_CODE",
) -> AsyncGenerator[str, None]:
    """Streaming LLM — yields text chunks as they arrive."""
    client = get_groq_client()
    sys = system_prompt or (
        DEFAULT_SYSTEM_PROMPT + "\n" + ACTION_SYSTEM_PROMPTS.get(action, "")
    )
    user_content = f"Context:\n```\n{context}\n```\n\n{prompt}" if context else prompt

    stream = await client.chat.completions.create(
        model=settings.GROQ_MODEL,
        messages=[
            {"role": "system", "content": sys},
            {"role": "user",   "content": user_content},
        ],
        stream=True,
        temperature=0.3,
        max_tokens=2048,
    )
    async for chunk in stream:
        delta = chunk.choices[0].delta.content
        if delta:
            yield delta
