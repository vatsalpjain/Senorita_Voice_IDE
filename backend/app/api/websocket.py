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
from app.agents.orchestrator import orchestrate

logger = logging.getLogger(__name__)
router = APIRouter()

LLM_ACTIONS = {"GENERATE_CODE", "DEBUG_MODE", "REVIEW_MODE", "EXPLAIN_CODE", "CHAT"}
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

                elif msg_type == "agentic_command":
                    # New agentic workflow — uses LangGraph orchestrator
                    await _handle_agentic_command(websocket, data)

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


async def _handle_agentic_command(websocket: WebSocket, data: dict):
    """
    Handles agentic commands via LangGraph orchestrator.
    Routes to Context → Intent Detection → Coding/Debug/Workflow/Explain agents.
    
    Expected data format:
    {
        "type": "agentic_command",
        "text": "create a function to sort a list",
        "file_path": "/path/to/file.py",
        "cursor_line": 10,
        "selection": "selected code if any",
        "project_root": "/path/to/project",
        "error_message": "optional error from terminal",
        "mode": "auto" | "coding" | "debug" | "workflow" | "explain",
        "skip_tts": true | false
    }
    
    Events sent:
      1. intent          — detected intent type
      2. agent_result    — structured result from the agent
      3. tts_start/done  — if skip_tts=False
      4. response_complete — final response with all data
    """
    transcript = data.get("text", "")
    file_path = data.get("file_path", "")
    file_content = data.get("file_content", "")
    cursor_line = data.get("cursor_line", 1)
    selection = data.get("selection", "")
    project_root = data.get("project_root", "")
    error_message = data.get("error_message", "")
    mode = data.get("mode", "auto")
    skip_tts = data.get("skip_tts", False)
    
    # Validate required fields
    if not transcript:
        await websocket.send_json({"type": "error", "message": "No text provided"})
        return
    
    # file_path is optional now - we can work with just file_content
    if not file_path and not file_content:
        await websocket.send_json({"type": "error", "message": "No file_path or file_content provided"})
        return
    
    # Activity callback to send real-time status updates
    async def on_activity(status: str, message: str, files: list):
        """Send activity updates to frontend in real-time"""
        try:
            await websocket.send_json({
                "type": "activity",
                "status": status,
                "message": message,
                "files": [f.split("/")[-1].split("\\")[-1] for f in files],  # Just filenames
            })
        except Exception:
            pass  # Ignore send errors
    
    # Run the orchestrator
    try:
        result = await orchestrate(
            transcript=transcript,
            file_path=file_path,
            file_content=file_content,
            cursor_line=cursor_line,
            selection=selection,
            project_root=project_root,
            error_message=error_message,
            mode=mode,
            on_activity=on_activity,
        )
    except Exception as e:
        logger.error(f"Orchestrator error: {e}")
        await websocket.send_json({"type": "error", "message": f"Orchestrator failed: {e}"})
        return
    
    # Send intent detection result
    intent = result.get("intent", "chat")
    logger.info(f"Sending intent: {intent}")
    await websocket.send_json({"type": "intent", "intent": intent})
    
    # Send agent result
    agent_result = result.get("result")
    if agent_result:
        logger.info(f"Sending agent_result: {agent_result.get('type')}")
        await websocket.send_json({
            "type": "agent_result",
            "result_type": agent_result.get("type"),
            "data": agent_result.get("data"),
        })
    
    # Get response text for TTS
    response_text = result.get("response_text", "")
    
    # TTS (Deepgram) — only when client does NOT handle TTS itself
    if not skip_tts and response_text:
        await websocket.send_json({"type": "tts_start"})
        try:
            audio_bytes = await text_to_speech(response_text)
            await websocket.send_bytes(audio_bytes)
        except Exception as e:
            logger.error(f"TTS failed (non-fatal): {e}")
        await websocket.send_json({"type": "tts_done"})
    
    # Send complete response
    logger.info(f"Sending response_complete: intent={intent}, text_len={len(response_text)}")
    await websocket.send_json({
        "type": "response_complete",
        "intent": intent,
        "result": agent_result,
        "text": response_text,
        "error": result.get("error"),
    })
