import asyncio
import io
import logging
import wave
from deepgram import AsyncDeepgramClient
from deepgram.core.events import EventType
from deepgram.core.api_error import ApiError
from app.config import settings

logger = logging.getLogger(__name__)


def get_deepgram_client() -> AsyncDeepgramClient:
    """
    Returns AsyncDeepgramClient for SDK v6.
    Auto-reads DEEPGRAM_API_KEY from settings (never hardcoded).
    """
    return AsyncDeepgramClient(api_key=settings.DEEPGRAM_API_KEY)


async def transcribe_audio(audio_bytes: bytes, mimetype: str = "audio/webm") -> str:
    """
    Batch STT transcription using Deepgram SDK v6.

    SDK v6: transcribe_file() accepts encoding but NOT sample_rate directly.
    For raw PCM (linear16) audio from mic, we wrap the bytes into a WAV
    container so Deepgram auto-detects sample rate from the WAV header —
    no manual encoding/sample_rate kwargs needed.

    For browser container formats (webm, ogg, mp4), pass bytes directly.
    """
    client = get_deepgram_client()
    try:
        payload = audio_bytes

        if mimetype in ("audio/pcm", "audio/raw", "audio/l16"):
            # Wrap raw int16 PCM into a WAV container (adds a 44-byte header)
            # so Deepgram can read sample rate and channels from the file header
            wav_buf = io.BytesIO()
            with wave.open(wav_buf, "wb") as wf:
                wf.setnchannels(1)          # Mono
                wf.setsampwidth(2)          # int16 = 2 bytes per sample
                wf.setframerate(16000)      # 16kHz — matches mic recording rate
                wf.writeframes(audio_bytes)
            payload = wav_buf.getvalue()

        response = await client.listen.v1.media.transcribe_file(
            request=payload,
            model=settings.DEEPGRAM_STT_MODEL,   # "nova-3"
            smart_format=True,
            language="en",
            # No encoding/sample_rate kwargs needed — WAV header carries that info
        )
        transcript = response.results.channels[0].alternatives[0].transcript
        return transcript.strip()
    except ApiError as e:
        logger.error(f"Deepgram STT ApiError: status={e.status_code} body={e.body}")
        raise
    except Exception as e:
        logger.error(f"Deepgram STT unexpected error: {e}")
        raise


async def run_live_transcription(
    audio_queue: asyncio.Queue,
    transcript_callback,
) -> None:
    """
    Opens a Deepgram live WebSocket session (SDK v6).
    Reads audio bytes from audio_queue, sends to Deepgram.
    Calls transcript_callback(text: str) on each final transcript.

    SDK v6 async live connection:
      - client.listen.v2.connect(...) is the async live streaming path
      - EventType.MESSAGE for transcripts
      - conn.send_media(bytes) — MUST be bytes
      - async with ... as conn: (async context manager)

    Note:
      listen.v1 = classic Nova batch transcription only
      listen.v2 = live streaming + contextual turn detection (async)
    """
    client = get_deepgram_client()

    # listen.v2.connect is the correct async live socket path in SDK v6
    async with client.listen.v2.connect(
        model=settings.DEEPGRAM_STT_MODEL,
        encoding="linear16",
        sample_rate=16000,
        smart_format=True,
        interim_results=True,
        language="en",
    ) as connection:

        # SDK v6 event handlers receive a single message object
        async def on_message(message):
            try:
                alt = message.channel.alternatives[0]
                text = alt.transcript.strip()
                if text and message.is_final:
                    await transcript_callback(text)
            except (AttributeError, IndexError):
                pass

        async def on_error(error):
            logger.error(f"Deepgram live error: {error}")

        connection.on(EventType.MESSAGE, on_message)
        connection.on(EventType.ERROR, on_error)

        await connection.start_listening()

        while True:
            audio_chunk = await audio_queue.get()
            if audio_chunk is None:
                break
            # send_media requires bytes in SDK v6 (NOT str)
            await connection.send_media(audio_chunk)
