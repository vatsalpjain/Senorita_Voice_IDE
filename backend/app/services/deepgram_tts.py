import logging
from typing import AsyncGenerator
from deepgram import AsyncDeepgramClient
from deepgram.core.api_error import ApiError
from app.config import settings

logger = logging.getLogger(__name__)


def get_deepgram_client() -> AsyncDeepgramClient:
    """Returns v6 SDK async client"""
    return AsyncDeepgramClient(api_key=settings.DEEPGRAM_API_KEY)


async def text_to_speech(
    text: str,
    voice: str | None = None,
    encoding: str = "mp3",
) -> bytes:
    """
    Convert text to speech (batch). Returns all audio bytes accumulated.

    SDK v6: speak.v1.audio.generate() is an ASYNC GENERATOR — yields byte
    chunks, NOT a single awaitable. Must use 'async for' to collect chunks.

    IMPORTANT for encoding + sample_rate:
      - "mp3"     → do NOT pass sample_rate (not configurable for mp3)
      - "linear16" → sample_rate=24000 or 16000 are supported values
      Always omit sample_rate when using mp3 to avoid SDK errors.
    """
    client = get_deepgram_client()
    model = voice or settings.DEEPGRAM_TTS_VOICE   # "aura-2-asteria-en"

    try:
        chunks: list[bytes] = []
        # Iterate the async generator — do NOT await the call itself
        async for chunk in client.speak.v1.audio.generate(
            text=text,
            model=model,
            encoding=encoding,
            # sample_rate intentionally omitted for mp3 — not configurable
        ):
            if chunk:
                chunks.append(chunk)
        return b"".join(chunks)
    except ApiError as e:
        logger.error(f"Deepgram TTS ApiError: status={e.status_code} body={e.body}")
        raise
    except Exception as e:
        logger.error(f"Deepgram TTS unexpected error: {e}")
        raise


async def stream_tts(
    text: str,
    voice: str | None = None,
    encoding: str = "mp3",
) -> AsyncGenerator[bytes, None]:
    """
    Streaming TTS — yields audio byte chunks for low-latency playback.

    SDK v6: async generator, iterate with async for.
    Encoding is mp3 by default — sample_rate is NOT passed for mp3
    because Deepgram does not allow configuring it for that format.
    """
    client = get_deepgram_client()
    model = voice or settings.DEEPGRAM_TTS_VOICE

    try:
        async for chunk in client.speak.v1.audio.generate(
            text=text,
            model=model,
            encoding=encoding,
            # sample_rate intentionally omitted — not valid for mp3 encoding
        ):
            if chunk:
                yield chunk
    except ApiError as e:
        logger.error(f"Deepgram TTS stream ApiError: {e.status_code} {e.body}")
        raise
