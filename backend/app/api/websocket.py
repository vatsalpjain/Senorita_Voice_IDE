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
    """Voice assistant primary websocket endpoint handling STT, TTS, and LLM processing"""
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
                    # Read optional mimetype from client — raw PCM needs "audio/pcm"
                    audio_mimetype = data.get("mimetype", "audio/webm")
                    try:
                        transcript = await transcribe_audio(audio_bytes, mimetype=audio_mimetype)
                    except Exception as e:
                        await websocket.send_json({"type": "error", "message": f"STT failed: {e}"})
                        continue
                    await websocket.send_json({"type": "transcript", "text": transcript})
                    # Deepgram audio path always generates TTS
                    await _handle_transcript(websocket, transcript, context=None, skip_tts=False)

                elif msg_type == "text_command":
                    transcript = data.get("text", "")
                    context    = data.get("context")
                    # Frontend can set skip_tts=true to handle TTS via Web Speech API
                    skip_tts   = data.get("skip_tts", False)
                    await _handle_transcript(websocket, transcript, context, skip_tts=skip_tts)

                elif msg_type == "ping":
                    await websocket.send_json({"type": "pong"})

    except WebSocketDisconnect:
        logger.info("Client disconnected from /ws/voice")
    except RuntimeError as e:
        # Starlette raises RuntimeError when receive() is called after disconnect
        if "disconnect" in str(e).lower():
            logger.info("Client disconnected from /ws/voice (stale receive)")
        else:
            logger.error(f"WebSocket runtime error: {e}")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass


async def _handle_transcript(
    websocket: WebSocket,
    transcript: str,
    context: str | None,
    *,
    skip_tts: bool = False,
):
    """
    Processes textual transcript → action → LLM/n8n/code → response.

    Events sent:
      1. action         — parsed intent + param
      2. llm_chunk      — streaming tokens (LLM actions only)
      3. tts_start      — if skip_tts=False
      4. <binary>       — TTS audio bytes, if skip_tts=False
      5. tts_done        — if skip_tts=False
      6. response_complete — always sent last, carries full assembled text + metadata
    """
    parsed = parse_command(transcript)
    action = parsed["action"]
    param  = parsed["param"]
    await websocket.send_json({"type": "action", "action": action, "param": param})

    response_text = ""
    code = None

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

    # ── TTS (Deepgram) — only when client does NOT handle TTS itself ──
    if not skip_tts:
        await websocket.send_json({"type": "tts_start"})
        try:
            audio_bytes = await text_to_speech(response_text)
            await websocket.send_bytes(audio_bytes)
        except Exception as e:
            logger.error(f"TTS failed (non-fatal): {e}")
        await websocket.send_json({"type": "tts_done"})

    # ── Always: send the complete assembled response so frontend can finalize ──
    await websocket.send_json({
        "type": "response_complete",
        "action": action,
        "text": response_text,
        "code": code,
    })
