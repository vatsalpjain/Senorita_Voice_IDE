"""
Wake Word Detection WebSocket Endpoint

Handles continuous audio streaming for wake word detection.
When wake word is detected, sends a notification to the client.

Flow:
1. Client connects and starts streaming audio
2. Server processes audio through wake word model
3. When detected, server sends {"type": "wake_word_detected", "confidence": 0.85}
4. Client triggers voice listening mode
5. After user stops speaking, client can resume wake word detection
"""

import json
import logging
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.services.wake_word_service import get_wake_word_service

logger = logging.getLogger(__name__)
router = APIRouter()

# Audio settings
SAMPLE_RATE = 16000
SAMPLE_WIDTH = 2  # 16-bit PCM


@router.websocket("/ws/wake-word")
async def wake_word_ws(websocket: WebSocket):
    """
    WebSocket endpoint for wake word detection.
    
    Client sends:
        - Binary: Raw PCM audio (16kHz, 16-bit mono)
        - JSON: {"type": "configure", "threshold": 0.5}
        - JSON: {"type": "reset"} - Reset after detection
        - JSON: {"type": "pause"} - Pause detection
        - JSON: {"type": "resume"} - Resume detection
        - JSON: {"type": "ping"}
    
    Server sends:
        - {"type": "connected", "available": true/false}
        - {"type": "wake_word_detected", "confidence": 0.85}
        - {"type": "probability", "value": 0.23} - Optional debug mode
        - {"type": "paused"}
        - {"type": "resumed"}
        - {"type": "pong"}
        - {"type": "error", "message": "..."}
    """
    await websocket.accept()
    
    # Get wake word service
    service = get_wake_word_service(threshold=0.5)
    
    # Send connection status
    await websocket.send_json({
        "type": "connected",
        "available": service.is_available,
        "threshold": service.threshold,
    })
    
    if not service.is_available:
        logger.warning("Wake word service not available - model not loaded")
    
    # State
    paused = False
    debug_mode = False  # If true, send probability on every frame
    cooldown_frames = 0  # Frames to skip after detection
    COOLDOWN_DURATION = 15  # ~1.5 seconds at 100ms frames
    
    try:
        while True:
            message = await websocket.receive()
            
            if "bytes" in message:
                # Audio data
                if paused or cooldown_frames > 0:
                    if cooldown_frames > 0:
                        cooldown_frames -= 1
                    continue
                
                audio_bytes = message["bytes"]
                detected, prob = service.process_audio_bytes(audio_bytes, sample_width=SAMPLE_WIDTH)
                
                # Debug mode: send probability
                if debug_mode:
                    if prob > 0.1:
                        logger.info(f"Wake word probability: {prob:.3f} (threshold: {service.threshold})")
                    await websocket.send_json({
                        "type": "probability",
                        "value": round(prob, 3),
                    })
                
                # Wake word detected!
                if detected:
                    logger.info(f"🎤 Wake word detected! Confidence: {prob:.2f}")
                    await websocket.send_json({
                        "type": "wake_word_detected",
                        "confidence": round(prob, 3),
                    })
                    # Enter cooldown to avoid repeated triggers
                    cooldown_frames = COOLDOWN_DURATION
                    service.reset()
            
            elif "text" in message:
                try:
                    data = json.loads(message["text"])
                except json.JSONDecodeError:
                    await websocket.send_json({"type": "error", "message": "Invalid JSON"})
                    continue
                
                msg_type = data.get("type")
                
                if msg_type == "configure":
                    # Update threshold
                    threshold = data.get("threshold")
                    if threshold is not None:
                        service.set_threshold(float(threshold))
                        await websocket.send_json({
                            "type": "configured",
                            "threshold": service.threshold,
                        })
                    # Toggle debug mode
                    if "debug" in data:
                        debug_mode = bool(data["debug"])
                
                elif msg_type == "reset":
                    service.reset()
                    cooldown_frames = 0
                    await websocket.send_json({"type": "reset_done"})
                
                elif msg_type == "pause":
                    paused = True
                    await websocket.send_json({"type": "paused"})
                
                elif msg_type == "resume":
                    paused = False
                    service.reset()  # Clear buffer on resume
                    await websocket.send_json({"type": "resumed"})
                
                elif msg_type == "ping":
                    await websocket.send_json({"type": "pong"})
                
                else:
                    logger.warning(f"Unknown wake word message type: {msg_type}")
    
    except WebSocketDisconnect:
        logger.info("Client disconnected from /ws/wake-word")
    except Exception as e:
        logger.error(f"Wake word WebSocket error: {e}")
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass
