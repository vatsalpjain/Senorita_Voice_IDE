import os
import json
import asyncio
from typing import Dict, Any
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from loguru import logger

from ..config.models import VoiceConfig, TranscriptionResult, VoiceState
from ..voice_ai.voice_controller import VoiceController

router = APIRouter(
    prefix="/voice",
    tags=["voice"]
)

@router.websocket("/ws")
async def voice_websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    logger.info("New WebSocket connection accepted for Voice AI")

    api_key = os.getenv("DEEPGRAM_API_KEY")
    if not api_key:
        logger.error("DEEPGRAM_API_KEY environment variable not set")
        await websocket.send_json({"error": "DEEPGRAM_API_KEY missing"})
        await websocket.close(code=1011)
        return

    config = VoiceConfig(
        deepgram_api_key=api_key,
        stt_model="nova-2",
        tts_model="aura-asteria-en",
        language="en-US",
        interruption_enabled=True,
    )
    
    controller = VoiceController(config)

    # --- Setup Callbacks to forward to WebSocket ---
    async def on_transcription_final(result: TranscriptionResult):
        await websocket.send_json({
            "type": "transcription_final",
            "text": result.text,
            "confidence": result.confidence
        })

    async def on_transcription_interim(result: TranscriptionResult):
        await websocket.send_json({
            "type": "transcription_interim",
            "text": result.text
        })

    async def on_state_change(new_state: VoiceState, previous_state: VoiceState):
        await websocket.send_json({
            "type": "state_change",
            "state": new_state.value
        })
        
    async def on_speech_ready(result):
        if result.audio_data:
            # Send an indicator first
            await websocket.send_json({
                "type": "speech_audio_start",
                "id": result.id
            })
            # Send the binary audio
            await websocket.send_bytes(result.audio_data)

    async def on_error(error: Exception):
        await websocket.send_json({
            "type": "error",
            "message": str(error)
        })

    controller.on_transcription_final = on_transcription_final
    controller.on_transcription_interim = on_transcription_interim
    controller.on_state_change = on_state_change
    controller.on_speech_ready = on_speech_ready
    controller.on_error = on_error

    try:
        await controller.initialize()
        await websocket.send_json({"type": "system_ready", "status": "initialized"})
        
        # Listen directly from websocket
        while True:
            # We must handle both text (JSON) and bytes (audio)
            message = await websocket.receive()
            
            if "bytes" in message:
                audio_data = message["bytes"]
                await controller.send_audio(audio_data)
                
            elif "text" in message:
                try:
                    data: Dict[str, Any] = json.loads(message["text"])
                    action = data.get("action")
                    
                    if action == "start_listening":
                        await controller.start_listening()
                    elif action == "stop_listening":
                        await controller.stop_listening()
                    elif action == "speak":
                        text = data.get("text", "")
                        if text:
                            await controller.speak(text)
                    elif action == "interrupt":
                        await controller.interrupt_speech()
                    elif action == "get_status":
                        status = controller.get_status()
                        await websocket.send_json({"type": "status", "status": status})
                    else:
                        logger.warning(f"Unknown action received: {action}")
                        
                except json.JSONDecodeError:
                    logger.warning("Received invalid JSON over websocket")

    except WebSocketDisconnect:
        logger.info("WebSocket disconnected")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
    finally:
        await controller.shutdown()
