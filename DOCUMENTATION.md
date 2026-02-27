# 🌹 PROJECT SENORITA — BACKEND DOCUMENTATION
### Voice-Powered AI Coding Assistant (Cursor-Like IDE Backend)
> **Agentic Build Guide v2** — Give this file to your agentic IDE. It contains every spec, file path, contract, and instruction needed to generate the entire backend from scratch.

---

## ⚠️ CRITICAL WARNING FOR AI AGENTS — READ THIS FIRST

> **AI models (GPT-4, Claude, Gemini, Copilot, Cursor, etc.) were trained on outdated Deepgram SDK code.**
> The old SDK versions (v2, v3, v4) used completely different APIs that **no longer exist** in v5.
> **This document reflects the CURRENT Deepgram Python SDK v5 (latest: 5.3.0, Nov 2025).**
> Do NOT fall back on training memory for Deepgram code. Follow this document exactly.
>
> ### What AI agents commonly get WRONG (and must NOT do):
>
> | ❌ OLD / WRONG (pre-v5) | ✅ CORRECT (SDK v5) |
> |---|---|
> | `deepgram = Deepgram("KEY")` | `client = DeepgramClient(api_key="KEY")` |
> | `deepgram.transcription.prerecorded(...)` | `client.listen.v1.media.transcribe_file(...)` |
> | `deepgram.listen.websocket.v("1")` | `client.listen.v1.connect(...)` or `client.listen.v2.connect(...)` |
> | `dg_connection.start(LiveOptions(...))` | `connection.start_listening()` |
> | `PrerecordedOptions(...)` passed separately | Pass `model=`, `smart_format=` directly as kwargs |
> | `deepgram.speak.rest.v("1").stream(text)` | `client.speak.v1.audio.generate(text=..., model=...)` |
> | `response.results.channels[0]...` for TTS | TTS returns `.stream.getvalue()` bytes |
> | `from deepgram import LiveTranscriptionEvents` | `from deepgram.core.events import EventType` |
> | `response.stream_memory` | `response.stream.getvalue()` |
>
> **Always use `AsyncDeepgramClient` for async FastAPI code. Never use the blocking `DeepgramClient` in async contexts.**
> **Always call `DEEPGRAM_API_KEY` from `settings`, never hardcode.**

---

## TABLE OF CONTENTS
1. [Project Overview](#1-project-overview)
2. [Tech Stack](#2-tech-stack)
3. [Full File & Folder Structure](#3-full-file--folder-structure)
4. [Environment Variables](#4-environment-variables)
5. [Config Module](#5-config-module)
6. [Data Models (Pydantic)](#6-data-models-pydantic)
7. [Command Parser](#7-command-parser)
8. [Services](#8-services)
   - 8.1 [Groq LLM Service](#81-groq-llm-service)
   - 8.2 [Deepgram STT Service — SDK v5](#82-deepgram-stt-service--sdk-v5)
   - 8.3 [Deepgram TTS Service — SDK v5](#83-deepgram-tts-service--sdk-v5)
   - 8.4 [Code Action Handler](#84-code-action-handler)
   - 8.5 [n8n Webhook Service](#85-n8n-webhook-service)
9. [WebSocket Voice Pipeline](#9-websocket-voice-pipeline)
10. [HTTP REST API Routes](#10-http-rest-api-routes)
11. [FastAPI Main Application](#11-fastapi-main-application)
12. [Dependencies & Installation](#12-dependencies--installation)
13. [Running the Server](#13-running-the-server)
14. [Frontend ↔ Backend Contract](#14-frontend--backend-contract)
15. [WebSocket Message Protocol](#15-websocket-message-protocol)
16. [Error Handling Strategy](#16-error-handling-strategy)
17. [Coding Conventions](#17-coding-conventions)

---

## 1. PROJECT OVERVIEW

**Senorita** is a voice-powered AI coding assistant backend. It functions like a Cursor IDE AI assistant but driven entirely by voice. The user speaks into a microphone in the frontend; the audio streams to the backend over a WebSocket, gets transcribed by Deepgram STT, parsed into an action command, processed by Groq's `llama-3.3-70b-versatile` LLM, and the text response is converted back to speech by Deepgram TTS and streamed back to the frontend.

### Core Loop
```
[Frontend Mic Audio]
        │
        ▼
[WebSocket /ws/voice]
        │
        ▼
[Deepgram STT → transcript string]
   (SDK v5: AsyncDeepgramClient + listen.v1.media.transcribe_file)
        │
        ▼
[Command Parser → {action, param}]
        │
        ▼
[Action Router]
   ├── GENERATE_CODE / EXPLAIN_CODE / DEBUG_MODE / REVIEW_MODE
   │       └──► Groq LLM (llama-3.3-70b-versatile)
   ├── CREATE_FILE / OPEN_FILE / SAVE_FILE / DELETE_FILE
   │       └──► Code Action Handler (returns instruction JSON to frontend)
   ├── GOTO_LINE / SCROLL_TO / FIND_IN_FILE
   │       └──► Navigation instruction JSON to frontend
   ├── TERMINAL_CMD
   │       └──► Terminal command string to frontend
   └── N8N_EMAIL / N8N_GITHUB / N8N_SLACK
           └──► n8n Webhook Service (HTTP POST)
        │
        ▼
[Response text assembled]
        │
        ▼
[Deepgram TTS → audio bytes]
   (SDK v5: AsyncDeepgramClient + speak.v1.audio.generate)
        │
        ▼
[WebSocket → Frontend plays audio + receives JSON action]
```

---

## 2. TECH STACK

| Layer | Technology | Notes |
|---|---|---|
| Web Framework | **FastAPI** | Async, WebSocket support built-in |
| LLM | **Groq API** — `llama-3.3-70b-versatile` | Not deprecated. Use `groq` Python SDK |
| STT | **Deepgram SDK v5** — `nova-3` model | `AsyncDeepgramClient` + `listen.v1.media.transcribe_file` |
| TTS | **Deepgram SDK v5** — `aura-2-asteria-en` voice | `AsyncDeepgramClient` + `speak.v1.audio.generate` |
| Live STT | **Deepgram SDK v5** — WebSocket live | `client.listen.v1.connect(...)` with EventType events |
| WebSocket | FastAPI native `WebSocket` | `/ws/voice` endpoint |
| Config | **Pydantic v2 `BaseSettings`** | `.env` file |
| HTTP Client | **httpx** | For n8n webhooks |
| Python | **3.11+** | Required |

---

## 3. FULL FILE & FOLDER STRUCTURE

Generate **every file listed below**. Do not skip any.

```
senorita/
└── backend/
    ├── app/
    │   ├── __init__.py
    │   ├── main.py                        # FastAPI app, lifespan, CORS, router mounts
    │   ├── config.py                      # Pydantic BaseSettings, env vars
    │   │
    │   ├── models/
    │   │   ├── __init__.py
    │   │   ├── command.py                 # CommandResult, ActionType enum
    │   │   ├── request.py                 # TextCommandRequest, TTSRequest
    │   │   └── response.py                # SenoResponse, ActionResponse
    │   │
    │   ├── tools/
    │   │   ├── __init__.py
    │   │   └── command_parser.py          # COMMAND_MAP + parse_command()
    │   │
    │   ├── services/
    │   │   ├── __init__.py
    │   │   ├── groq_service.py            # Groq LLM wrapper
    │   │   ├── deepgram_stt.py            # Deepgram STT (batch + live websocket)
    │   │   ├── deepgram_tts.py            # Deepgram TTS → audio bytes
    │   │   ├── code_actions.py            # Handles FILE/NAV/TERMINAL actions
    │   │   └── n8n_service.py             # n8n webhook triggers
    │   │
    │   └── api/
    │       ├── __init__.py
    │       ├── routes.py                  # All HTTP REST endpoints
    │       └── websocket.py               # /ws/voice WebSocket handler
    │
    ├── tests/
    │   ├── __init__.py
    │   ├── test_command_parser.py
    │   ├── test_groq_service.py
    │   └── test_websocket.py
    │
    ├── .env.example
    ├── requirements.txt
    ├── run.py                             # Entrypoint: uvicorn
    └── README.md
```

---

## 4. ENVIRONMENT VARIABLES

**File: `backend/.env.example`**

```env
# ── LLM ─────────────────────────────────────────
GROQ_API_KEY=your_groq_api_key_here

# ── Deepgram ─────────────────────────────────────
DEEPGRAM_API_KEY=your_deepgram_api_key_here

# ── n8n Webhooks ──────────────────────────────────
N8N_EMAIL_WEBHOOK_URL=https://your-n8n-instance.com/webhook/email-summary
N8N_GITHUB_WEBHOOK_URL=https://your-n8n-instance.com/webhook/create-issue
N8N_SLACK_WEBHOOK_URL=https://your-n8n-instance.com/webhook/notify-team

# ── App Settings ──────────────────────────────────
APP_ENV=development
ALLOWED_ORIGINS=["http://localhost:3000","http://localhost:5173"]
LOG_LEVEL=INFO
```

---

## 5. CONFIG MODULE

**File: `backend/app/config.py`**

```python
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    # Groq
    GROQ_API_KEY: str
    GROQ_MODEL: str = "llama-3.3-70b-versatile"   # HARDCODED — do not change

    # Deepgram (SDK v5)
    DEEPGRAM_API_KEY: str
    DEEPGRAM_STT_MODEL: str = "nova-3"              # nova-3 is current model (NOT nova-2)
    DEEPGRAM_TTS_VOICE: str = "aura-2-asteria-en"  # aura-2-* voices are current (NOT aura-*)

    # n8n
    N8N_EMAIL_WEBHOOK_URL: str = ""
    N8N_GITHUB_WEBHOOK_URL: str = ""
    N8N_SLACK_WEBHOOK_URL: str = ""

    # App
    APP_ENV: str = "development"
    ALLOWED_ORIGINS: list[str] = ["http://localhost:3000"]
    LOG_LEVEL: str = "INFO"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

settings = Settings()
```

> ⚠️ **Note on model names**: `nova-3` (not `nova-2`) is the current STT model. `aura-2-asteria-en` (not `aura-asteria-en`) is the current TTS voice. Old names may still work but always prefer the current ones.

---

## 6. DATA MODELS (PYDANTIC)

### `backend/app/models/command.py`
```python
from enum import Enum
from pydantic import BaseModel

class ActionType(str, Enum):
    CREATE_FILE   = "CREATE_FILE"
    OPEN_FILE     = "OPEN_FILE"
    SAVE_FILE     = "SAVE_FILE"
    DELETE_FILE   = "DELETE_FILE"
    GENERATE_CODE = "GENERATE_CODE"
    GOTO_LINE     = "GOTO_LINE"
    SCROLL_TO     = "SCROLL_TO"
    FIND_IN_FILE  = "FIND_IN_FILE"
    DEBUG_MODE    = "DEBUG_MODE"
    REVIEW_MODE   = "REVIEW_MODE"
    EXPLAIN_CODE  = "EXPLAIN_CODE"
    TERMINAL_CMD  = "TERMINAL_CMD"
    N8N_EMAIL     = "N8N_EMAIL"
    N8N_GITHUB    = "N8N_GITHUB"
    N8N_SLACK     = "N8N_SLACK"

class CommandResult(BaseModel):
    action: ActionType
    raw: str
    param: str
```

### `backend/app/models/request.py`
```python
from pydantic import BaseModel

class TextCommandRequest(BaseModel):
    transcript: str
    context: str | None = None

class TTSRequest(BaseModel):
    text: str
    voice: str = "aura-2-asteria-en"   # SDK v5 voice name
```

### `backend/app/models/response.py`
```python
from pydantic import BaseModel

class ActionResponse(BaseModel):
    action: str
    param: str
    instruction: dict | None = None

class SenoResponse(BaseModel):
    transcript: str
    action: str
    llm_response: str | None = None
    instruction: dict | None = None
    audio_url: str | None = None
    error: str | None = None
```

---

## 7. COMMAND PARSER

**File: `backend/app/tools/command_parser.py`**

Multi-word phrases must appear BEFORE single-word phrases to ensure correct matching.

```python
COMMAND_MAP = {
    # File operations (multi-word first)
    "create file":   "CREATE_FILE",
    "open file":     "OPEN_FILE",
    "save file":     "SAVE_FILE",
    "delete file":   "DELETE_FILE",
    # Navigation (multi-word first)
    "go to line":    "GOTO_LINE",
    "scroll to":     "SCROLL_TO",
    "find":          "FIND_IN_FILE",
    # Modes
    "debug":         "DEBUG_MODE",
    "review":        "REVIEW_MODE",
    "explain":       "EXPLAIN_CODE",
    # Terminal (multi-word first)
    "start server":  "TERMINAL_CMD",
    "install":       "TERMINAL_CMD",
    "run":           "TERMINAL_CMD",
    "git":           "TERMINAL_CMD",
    # Code generation (broad — check last)
    "implement":     "GENERATE_CODE",
    "write":         "GENERATE_CODE",
    "create":        "GENERATE_CODE",
    "add":           "GENERATE_CODE",
    # n8n workflows
    "email summary": "N8N_EMAIL",
    "create issue":  "N8N_GITHUB",
    "notify team":   "N8N_SLACK",
}

def parse_command(transcript: str) -> dict:
    transcript_lower = transcript.lower()
    for phrase, action in COMMAND_MAP.items():
        if phrase in transcript_lower:
            return {
                "action": action,
                "raw": transcript,
                "param": transcript_lower.replace(phrase, "").strip()
            }
    return {"action": "GENERATE_CODE", "raw": transcript, "param": transcript}
```

---

## 8. SERVICES

---

### 8.1 GROQ LLM SERVICE

**File: `backend/app/services/groq_service.py`**

```python
import logging
from typing import AsyncGenerator
from groq import AsyncGroq
from app.config import settings

logger = logging.getLogger(__name__)

_groq_client: AsyncGroq | None = None

def get_groq_client() -> AsyncGroq:
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
```

---

### 8.2 DEEPGRAM STT SERVICE — SDK v5

**File: `backend/app/services/deepgram_stt.py`**

> ⚠️ **AGENT WARNING**: This uses Deepgram Python SDK v5. The API is completely different from v2/v3/v4.
> Do NOT use `Deepgram(key)`, `PrerecordedOptions`, `listen.websocket.v("1")`, or `dg_connection.start(...)`.
> All imports come from the `deepgram` package using the v5 structure shown below.

```python
"""
Deepgram STT — SDK v5

CORRECT v5 imports:
  from deepgram import AsyncDeepgramClient
  from deepgram.core.events import EventType
  from deepgram.core.api_error import ApiError

CORRECT v5 batch transcription:
  await client.listen.v1.media.transcribe_file(request=bytes, model="nova-3")
  result: response.results.channels[0].alternatives[0].transcript

CORRECT v5 live WebSocket:
  async with client.listen.v1.connect(model="nova-3", encoding="linear16", sample_rate=16000) as conn:
      conn.on(EventType.MESSAGE, handler)
      await conn.start_listening()
      await conn.send_media(audio_bytes)   # MUST be bytes, not str
"""
import asyncio
import logging
from deepgram import AsyncDeepgramClient
from deepgram.core.events import EventType
from deepgram.core.api_error import ApiError
from app.config import settings

logger = logging.getLogger(__name__)


def get_deepgram_client() -> AsyncDeepgramClient:
    """
    Returns AsyncDeepgramClient for SDK v5.
    SDK v5 constructor: AsyncDeepgramClient(api_key=...)
    Also auto-reads DEEPGRAM_API_KEY env var. Always pass explicitly.
    """
    return AsyncDeepgramClient(api_key=settings.DEEPGRAM_API_KEY)


async def transcribe_audio(audio_bytes: bytes, mimetype: str = "audio/webm") -> str:
    """
    Batch STT transcription using Deepgram SDK v5.

    SDK v5 call:
      response = await client.listen.v1.media.transcribe_file(
          request=audio_bytes,
          model="nova-3",
          smart_format=True,
          language="en",
      )

    Extract transcript (v5):
      response.results.channels[0].alternatives[0].transcript

    Returns empty string if audio is silent.
    Raises ApiError on Deepgram failure (catch at call site).
    """
    client = get_deepgram_client()
    try:
        response = await client.listen.v1.media.transcribe_file(
            request=audio_bytes,
            model=settings.DEEPGRAM_STT_MODEL,   # "nova-3"
            smart_format=True,
            language="en",
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
    Opens a Deepgram live WebSocket session (SDK v5).
    Reads audio bytes from audio_queue, sends to Deepgram.
    Calls transcript_callback(text: str) on each final transcript.

    SDK v5 live connection:
      - client.listen.v1.connect(...)  (NOT listen.websocket.v("1"))
      - EventType.MESSAGE for transcripts
      - conn.send_media(bytes)  — MUST be bytes
      - async with ... as conn:  (async context manager)

    Note:
      listen.v1 = classic Nova model + standard streaming
      listen.v2 = flux model + contextual turn detection
      Use listen.v1 with nova-3 for production reliability.
    """
    client = get_deepgram_client()

    async with client.listen.v1.connect(
        model=settings.DEEPGRAM_STT_MODEL,
        encoding="linear16",
        sample_rate=16000,
        smart_format=True,
        interim_results=True,
        language="en",
    ) as connection:

        async def on_message(message):
            try:
                alt = message.channel.alternatives[0]
                text = alt.transcript.strip()
                if text and message.is_final:
                    await transcript_callback(text)
            except (AttributeError, IndexError):
                pass

        connection.on(EventType.MESSAGE, on_message)
        connection.on(EventType.ERROR, lambda err: logger.error(f"DG live error: {err}"))

        await connection.start_listening()

        while True:
            audio_chunk = await audio_queue.get()
            if audio_chunk is None:
                break
            # send_media requires bytes in SDK v5 (NOT str)
            await connection.send_media(audio_chunk)
```

---

### 8.3 DEEPGRAM TTS SERVICE — SDK v5

**File: `backend/app/services/deepgram_tts.py`**

> ⚠️ **AGENT WARNING**: SDK v5 TTS does NOT use manual httpx REST calls.
> Use `client.speak.v1.audio.generate(...)` from the SDK.
> Do NOT use `response.stream_memory` — use `response.stream.getvalue()`.
> TTS voice is `aura-2-asteria-en` (NOT `aura-asteria-en`).

```python
"""
Deepgram TTS — SDK v5

CORRECT v5 TTS (batch, returns all bytes at once):
  response = await client.speak.v1.audio.generate(
      text="Hello world",
      model="aura-2-asteria-en",
      encoding="mp3",
  )
  audio_bytes = response.stream.getvalue()    # NOT response.stream_memory

CORRECT v5 TTS (streaming, yields chunks):
  async for chunk in client.speak.v1.audio.generate(
      text="Hello world",
      model="aura-2-asteria-en",
      encoding="linear16",
      sample_rate=16000,
  ):
      process(chunk)    # chunk is bytes
"""
import logging
from typing import AsyncGenerator
from deepgram import AsyncDeepgramClient
from deepgram.core.api_error import ApiError
from app.config import settings

logger = logging.getLogger(__name__)


def get_deepgram_client() -> AsyncDeepgramClient:
    return AsyncDeepgramClient(api_key=settings.DEEPGRAM_API_KEY)


async def text_to_speech(
    text: str,
    voice: str | None = None,
    encoding: str = "mp3",
) -> bytes:
    """
    Convert text to speech (batch). Returns raw audio bytes.

    SDK v5:
      response = await client.speak.v1.audio.generate(text=, model=, encoding=)
      return response.stream.getvalue()
    """
    client = get_deepgram_client()
    model = voice or settings.DEEPGRAM_TTS_VOICE   # "aura-2-asteria-en"

    try:
        response = await client.speak.v1.audio.generate(
            text=text,
            model=model,
            encoding=encoding,
        )
        # SDK v5: audio bytes in response.stream.getvalue()
        return response.stream.getvalue()
    except ApiError as e:
        logger.error(f"Deepgram TTS ApiError: status={e.status_code} body={e.body}")
        raise
    except Exception as e:
        logger.error(f"Deepgram TTS unexpected error: {e}")
        raise


async def stream_tts(
    text: str,
    voice: str | None = None,
    encoding: str = "linear16",
    sample_rate: int = 16000,
) -> AsyncGenerator[bytes, None]:
    """
    Streaming TTS — yields audio byte chunks for low-latency playback.

    SDK v5:
      async for chunk in client.speak.v1.audio.generate(...):
          yield chunk
    """
    client = get_deepgram_client()
    model = voice or settings.DEEPGRAM_TTS_VOICE

    try:
        async for chunk in client.speak.v1.audio.generate(
            text=text,
            model=model,
            encoding=encoding,
            sample_rate=sample_rate,
        ):
            yield chunk
    except ApiError as e:
        logger.error(f"Deepgram TTS stream ApiError: {e.status_code} {e.body}")
        raise
```

---

### 8.4 CODE ACTION HANDLER

**File: `backend/app/services/code_actions.py`**

```python
import re
from app.models.command import CommandResult, ActionType

def handle_action(command: CommandResult) -> dict | None:
    """
    For IDE actions (non-LLM), returns a structured instruction dict.
    For LLM actions (GENERATE_CODE, DEBUG_MODE, etc.), returns None.
    """
    action = command.action
    param  = command.param

    if action == ActionType.CREATE_FILE:
        return {"type": "CREATE_FILE", "filename": param}
    elif action == ActionType.OPEN_FILE:
        return {"type": "OPEN_FILE", "filename": param}
    elif action == ActionType.SAVE_FILE:
        return {"type": "SAVE_FILE", "filename": param or "current"}
    elif action == ActionType.DELETE_FILE:
        return {"type": "DELETE_FILE", "filename": param}
    elif action == ActionType.GOTO_LINE:
        numbers = re.findall(r"\d+", param)
        line = int(numbers[0]) if numbers else 1
        return {"type": "GOTO_LINE", "line": line}
    elif action == ActionType.SCROLL_TO:
        return {"type": "SCROLL_TO", "target": param}
    elif action == ActionType.FIND_IN_FILE:
        return {"type": "FIND_IN_FILE", "query": param}
    elif action == ActionType.TERMINAL_CMD:
        return {"type": "TERMINAL_CMD", "command": param}

    return None   # LLM actions handled by caller
```

---

### 8.5 n8n WEBHOOK SERVICE

**File: `backend/app/services/n8n_service.py`**

```python
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
```

---

## 9. WEBSOCKET VOICE PIPELINE

**File: `backend/app/api/websocket.py`**

Mount at `/ws/voice`.

### Connection Lifecycle

```
Client connects ws://host/ws/voice
  → Server: {"type": "connected", "message": "Senorita is listening"}
  → Client streams binary audio frames (WebM/Opus or PCM)
  → Client: {"type": "end_audio"} — triggers batch STT
  → Server: Deepgram SDK v5 transcribe_file
  → Server: {"type": "transcript", "text": "..."}
  → Server: parse_command
  → Server: {"type": "action", "action": "...", "param": "..."}
  → Server: LLM stream / IDE instruction / n8n
  → Server: {"type": "llm_chunk", "text": "..."} (repeated)
  → Server: Deepgram SDK v5 TTS
  → Server: {"type": "tts_start"}
  → Server: binary audio bytes (mp3)
  → Server: {"type": "tts_done"}
  → Loop
```

### Full Implementation

```python
import asyncio
import json
import logging
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from app.tools.command_parser import parse_command
from app.services.groq_service import stream_llm
from app.services.deepgram_stt import transcribe_audio
from app.services.deepgram_tts import text_to_speech
from app.services.code_actions import handle_action
from app.services.n8n_service import trigger_n8n
from app.models.command import CommandResult, ActionType

logger = logging.getLogger(__name__)
router = APIRouter()

LLM_ACTIONS = {"GENERATE_CODE", "DEBUG_MODE", "REVIEW_MODE", "EXPLAIN_CODE"}
N8N_ACTIONS = {"N8N_EMAIL", "N8N_GITHUB", "N8N_SLACK"}


@router.websocket("/ws/voice")
async def voice_ws(websocket: WebSocket):
    await websocket.accept()
    await websocket.send_json({"type": "connected", "message": "Senorita is listening"})
    audio_buffer: list[bytes] = []

    try:
        while True:
            message = await websocket.receive()

            if "bytes" in message:
                audio_buffer.append(message["bytes"])

            elif "text" in message:
                try:
                    data = json.loads(message["text"])
                except json.JSONDecodeError:
                    await websocket.send_json({"type": "error", "message": "Invalid JSON"})
                    continue

                msg_type = data.get("type")

                if msg_type == "end_audio":
                    if not audio_buffer:
                        await websocket.send_json({"type": "error", "message": "No audio received"})
                        continue
                    audio_bytes = b"".join(audio_buffer)
                    audio_buffer.clear()
                    try:
                        transcript = await transcribe_audio(audio_bytes)
                    except Exception as e:
                        await websocket.send_json({"type": "error", "message": f"STT failed: {e}"})
                        continue
                    await websocket.send_json({"type": "transcript", "text": transcript})
                    await _handle_transcript(websocket, transcript, context=None)

                elif msg_type == "text_command":
                    transcript = data.get("text", "")
                    context    = data.get("context")
                    await _handle_transcript(websocket, transcript, context)

                elif msg_type == "ping":
                    await websocket.send_json({"type": "pong"})

    except WebSocketDisconnect:
        logger.info("Client disconnected from /ws/voice")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass


async def _handle_transcript(
    websocket: WebSocket, transcript: str, context: str | None
):
    parsed = parse_command(transcript)
    action = parsed["action"]
    param  = parsed["param"]
    await websocket.send_json({"type": "action", "action": action, "param": param})

    response_text = ""

    if action in LLM_ACTIONS:
        chunks = []
        try:
            async for chunk in stream_llm(param, context=context, action=action):
                chunks.append(chunk)
                await websocket.send_json({"type": "llm_chunk", "text": chunk})
            response_text = "".join(chunks)
        except Exception as e:
            await websocket.send_json({"type": "error", "message": f"LLM error: {e}"})
            response_text = "I had trouble thinking. Please try again."

    elif action in N8N_ACTIONS:
        result = await trigger_n8n(action, {"param": param})
        await websocket.send_json({"type": "n8n_result", **result})
        response_text = f"Done. {action.replace('_', ' ').title()} triggered."

    else:
        cmd = CommandResult(action=ActionType(action), raw=transcript, param=param)
        instruction = handle_action(cmd)
        if instruction:
            await websocket.send_json({"type": "instruction", "instruction": instruction})
        response_text = f"Got it. {action.replace('_', ' ').lower()} {param}."

    # TTS via Deepgram SDK v5
    await websocket.send_json({"type": "tts_start"})
    try:
        audio_bytes = await text_to_speech(response_text)
        await websocket.send_bytes(audio_bytes)
    except Exception as e:
        logger.error(f"TTS failed (non-fatal): {e}")
    await websocket.send_json({"type": "tts_done"})
```

---

## 10. HTTP REST API ROUTES

**File: `backend/app/api/routes.py`**

Mount under `/api`.

```
POST   /api/command          — Text command → SenoResponse
POST   /api/tts              — Text → StreamingResponse (audio/mpeg)
POST   /api/transcribe       — Upload audio → {transcript}
GET    /api/voices           — Available TTS voices
POST   /api/n8n/{action}     — Trigger n8n webhook manually
GET    /api/status           — Health check
```

#### `POST /api/tts`
Uses `text_to_speech(text, voice)` from SDK v5. Returns `StreamingResponse(content=bytes, media_type="audio/mpeg")`.

#### `GET /api/voices`
Returns current Deepgram Aura-2 voice names (SDK v5):
```python
[
  {"id": "aura-2-asteria-en", "name": "Asteria"},
  {"id": "aura-2-luna-en",    "name": "Luna"},
  {"id": "aura-2-stella-en",  "name": "Stella"},
  {"id": "aura-2-zeus-en",    "name": "Zeus"},
  {"id": "aura-2-orion-en",   "name": "Orion"},
  {"id": "aura-2-thalia-en",  "name": "Thalia"},
]
# ⚠️ "aura-2-*" not "aura-*" — SDK v5 naming
```

#### `GET /api/status`
```json
{
  "groq":     {"ok": true, "model": "llama-3.3-70b-versatile"},
  "deepgram": {"ok": true, "sdk_version": "v5"},
  "n8n":      {"email": true, "github": false, "slack": true}
}
```

---

## 11. FASTAPI MAIN APPLICATION

**File: `backend/app/main.py`**

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from app.config import settings
from app.api.routes import router as http_router
from app.api.websocket import router as ws_router
import logging

logging.basicConfig(level=settings.LOG_LEVEL)
logger = logging.getLogger("senorita")

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("🌹 Senorita backend starting...")
    logger.info(f"LLM: {settings.GROQ_MODEL}")
    logger.info(f"STT: Deepgram SDK v5 / {settings.DEEPGRAM_STT_MODEL}")
    logger.info(f"TTS: Deepgram SDK v5 / {settings.DEEPGRAM_TTS_VOICE}")
    yield
    logger.info("🌹 Senorita backend shutting down.")

app = FastAPI(
    title="Senorita",
    description="Voice-Powered AI Coding Assistant Backend",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(http_router, prefix="/api")
app.include_router(ws_router)

@app.get("/")
async def root():
    return {"project": "Senorita", "status": "alive", "version": "1.0.0"}

@app.get("/health")
async def health():
    return {"status": "ok"}
```

**File: `backend/run.py`**
```python
import uvicorn
if __name__ == "__main__":
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
```

---

## 12. DEPENDENCIES & INSTALLATION

**File: `backend/requirements.txt`**

```
fastapi>=0.111.0
uvicorn[standard]>=0.29.0
pydantic>=2.7.0
pydantic-settings>=2.3.0
groq>=0.9.0
deepgram-sdk>=5.3.0        # MUST be v5+ — NOT v3 or v4
httpx>=0.27.0
python-multipart>=0.0.9
python-dotenv>=1.0.1
websockets>=12.0
```

> ⚠️ **`deepgram-sdk>=5.3.0` is required.** SDK v3/v4 have completely different APIs.
> After install, verify: `python -c "import deepgram; print(deepgram.__version__)"`
> Expected output: `5.3.0` or higher.

---

## 13. RUNNING THE SERVER

```bash
cd backend
cp .env.example .env
# Fill in GROQ_API_KEY and DEEPGRAM_API_KEY

pip install -r requirements.txt
python run.py

# OR directly:
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

- API: `http://localhost:8000`
- WebSocket: `ws://localhost:8000/ws/voice`
- Swagger: `http://localhost:8000/docs`

---

## 14. FRONTEND ↔ BACKEND CONTRACT

| Channel | Protocol | Purpose |
|---|---|---|
| `ws://host/ws/voice` | WebSocket | Audio streaming, transcripts, TTS audio |
| `POST /api/command` | HTTP REST | Text-only commands |
| `POST /api/tts` | HTTP REST | On-demand TTS |
| `POST /api/transcribe` | HTTP REST | Upload audio clip for transcription |

Frontend responsibilities:
- Capture mic via MediaRecorder API (WebM/Opus)
- Stream binary chunks over WebSocket
- Send `{"type": "end_audio"}` to trigger STT
- Play received binary frames as TTS audio
- Execute `instruction` payloads (open file, goto line, run terminal command, etc.)
- Render `llm_chunk` tokens in real-time in a chat panel

---

## 15. WEBSOCKET MESSAGE PROTOCOL

```jsonc
// Server → Client
{"type": "connected",    "message": "Senorita is listening"}
{"type": "transcript",   "text": "create a function to sort a list"}
{"type": "action",       "action": "GENERATE_CODE", "param": "a function to sort a list"}
{"type": "instruction",  "instruction": {"type": "CREATE_FILE", "filename": "utils.py"}}
{"type": "llm_chunk",    "text": "def sort_list"}
{"type": "tts_start"}
// ... binary audio bytes (mp3) ...
{"type": "tts_done"}
{"type": "n8n_result",   "status": "triggered", "action": "N8N_EMAIL"}
{"type": "error",        "message": "STT failed: ..."}
{"type": "pong"}

// Client → Server
{"type": "end_audio"}                                        // triggers STT
{"type": "text_command", "text": "explain this", "context": "def foo(): ..."}
{"type": "ping"}
// ... binary audio frames ...
```

---

## 16. ERROR HANDLING STRATEGY

| Scenario | Behavior |
|---|---|
| Deepgram STT `ApiError` | Catch, log `e.status_code` + `e.body`, send error JSON, keep WS open |
| Deepgram TTS `ApiError` | Catch, log, skip audio bytes, still send `tts_done` to unblock frontend |
| Empty audio buffer | Skip STT, send `{"type":"error","message":"No audio received"}` |
| Groq LLM failure | Send error JSON, respond with fallback voice message |
| n8n not configured | Log warning, return `{"status":"not_configured"}` |
| n8n HTTP error | Return `{"status":"error","detail":...}` |
| WebSocket disconnect | Catch `WebSocketDisconnect`, clean buffer, log, exit handler |
| Invalid JSON from client | Catch `json.JSONDecodeError`, send error, continue loop |

---

## 17. CODING CONVENTIONS

- **Always `AsyncDeepgramClient`**: Never use blocking `DeepgramClient` in async FastAPI context.
- **SDK version check**: `deepgram-sdk>=5.3.0` — verify on install, never use v3/v4 patterns.
- **Model names**: `nova-3` (STT), `aura-2-asteria-en` (TTS), `llama-3.3-70b-versatile` (LLM).
- **No hardcoded secrets**: Always read from `settings.*`.
- **Error imports**: `from deepgram.core.api_error import ApiError`.
- **Event imports**: `from deepgram.core.events import EventType`.
- **`send_media` = bytes**: When sending audio to Deepgram live connection, always pass `bytes`.
- **TTS result**: `response.stream.getvalue()` — never `response.stream_memory`.
- **Logging**: `logger = logging.getLogger(__name__)` per module. No `print()`.
- **Full type hints** on all functions.
- **Pydantic v2**: `model_config = SettingsConfigDict(...)`, never `class Config`.
- **Async everywhere**: No blocking I/O in async routes.

---

## DEEPGRAM SDK v5 — MASTER CHEAT SHEET

```python
# ─── INSTALL ──────────────────────────────────────────────
pip install "deepgram-sdk>=5.3.0"
# Verify: python -c "import deepgram; print(deepgram.__version__)"

# ─── CLIENT ───────────────────────────────────────────────
from deepgram import AsyncDeepgramClient
client = AsyncDeepgramClient(api_key="YOUR_KEY")
# OR auto-reads DEEPGRAM_API_KEY env var:
client = AsyncDeepgramClient()

# ─── STT BATCH ────────────────────────────────────────────
response = await client.listen.v1.media.transcribe_file(
    request=audio_bytes,     # bytes
    model="nova-3",
    smart_format=True,
    language="en",
)
text = response.results.channels[0].alternatives[0].transcript

# ─── STT LIVE STREAM ──────────────────────────────────────
from deepgram.core.events import EventType

async with client.listen.v1.connect(
    model="nova-3",
    encoding="linear16",
    sample_rate=16000,
    smart_format=True,
    interim_results=True,
) as connection:
    connection.on(EventType.MESSAGE, my_handler)
    connection.on(EventType.ERROR, err_handler)
    await connection.start_listening()
    await connection.send_media(audio_bytes)   # bytes required

# ─── TTS BATCH ────────────────────────────────────────────
response = await client.speak.v1.audio.generate(
    text="Hello from Senorita",
    model="aura-2-asteria-en",
    encoding="mp3",
)
audio_bytes = response.stream.getvalue()       # NOT .stream_memory

# ─── TTS STREAMING ────────────────────────────────────────
async for chunk in client.speak.v1.audio.generate(
    text="Hello from Senorita",
    model="aura-2-asteria-en",
    encoding="linear16",
    sample_rate=16000,
):
    await websocket.send_bytes(chunk)

# ─── ERROR HANDLING ───────────────────────────────────────
from deepgram.core.api_error import ApiError
try:
    response = await client.listen.v1.media.transcribe_file(...)
except ApiError as e:
    print(e.status_code, e.body)
```

---

## QUICK REFERENCE — Import Map

```python
from app.config                  import settings
from app.models.command          import CommandResult, ActionType
from app.models.request          import TextCommandRequest, TTSRequest
from app.models.response         import SenoResponse, ActionResponse
from app.tools.command_parser    import parse_command, COMMAND_MAP
from app.services.groq_service   import ask_llm, stream_llm
from app.services.deepgram_stt   import transcribe_audio, run_live_transcription
from app.services.deepgram_tts   import text_to_speech, stream_tts
from app.services.code_actions   import handle_action
from app.services.n8n_service    import trigger_n8n

# Deepgram SDK v5 — always use these, never old-style
from deepgram                    import AsyncDeepgramClient
from deepgram.core.events        import EventType
from deepgram.core.api_error     import ApiError
```

---

*Documentation Version: 2.0.0 — Project Senorita*
*Deepgram SDK: v5.3.0+ | LLM: llama-3.3-70b-versatile | STT: nova-3 | TTS: aura-2-asteria-en*
*Last updated: February 2026*
