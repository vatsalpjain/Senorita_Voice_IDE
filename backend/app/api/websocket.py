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
    """Processes textual transcript to an actionable response and sends TTS format"""
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
