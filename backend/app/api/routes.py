import logging
from typing import List
from fastapi import APIRouter, File, UploadFile, HTTPException
from fastapi.responses import StreamingResponse
import io

from app.models.request import TextCommandRequest, TTSRequest
from app.models.response import SenoResponse
from app.tools.command_parser import parse_command
from app.services.groq_service import ask_llm
from app.services.deepgram_stt import transcribe_audio
from app.services.deepgram_tts import text_to_speech
from app.services.code_actions import handle_action
from app.services.n8n_service import trigger_n8n
from app.models.command import CommandResult, ActionType
from app.config import settings

logger = logging.getLogger(__name__)
router = APIRouter()

LLM_ACTIONS = {"GENERATE_CODE", "DEBUG_MODE", "REVIEW_MODE", "EXPLAIN_CODE"}
N8N_ACTIONS = {"N8N_EMAIL", "N8N_GITHUB", "N8N_SLACK"}

@router.post("/command", response_model=SenoResponse)
async def process_command(request: TextCommandRequest):
    """Processes explicit text requests simulating the voice transcript action process"""
    parsed = parse_command(request.transcript)
    action = parsed["action"]
    param  = parsed["param"]
    
    response_data = SenoResponse(
        transcript=request.transcript,
        action=action
    )

    try:
        if action in LLM_ACTIONS:
            response_data.llm_response = await ask_llm(param, context=request.context, action=action)
        elif action in N8N_ACTIONS:
            result = await trigger_n8n(action, {"param": param})
            response_data.instruction = result 
        else:
            cmd = CommandResult(action=ActionType(action), raw=request.transcript, param=param)
            instruction = handle_action(cmd)
            response_data.instruction = instruction
            
    except Exception as e:
        logger.error(f"Error processing command {action}: {e}")
        response_data.error = str(e)
        
    return response_data

@router.post("/tts")
async def generate_tts(request: TTSRequest):
    """Converts requested text string to Streamed voice audio mp3 playback"""
    try:
        audio_bytes = await text_to_speech(request.text, request.voice)
        return StreamingResponse(io.BytesIO(audio_bytes), media_type="audio/mpeg")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/transcribe")
async def transcribe_upload(file: UploadFile = File(...)):
    """Transcribes strictly uploaded audio file requests"""
    try:
        audio_bytes = await file.read()
        transcript = await transcribe_audio(audio_bytes, file.content_type)
        return {"transcript": transcript}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/voices")
async def get_voices():
    """Returns the list of Deepgram Aura-2 compatible voices based on SDK v5"""
    return [
      {"id": "aura-2-asteria-en", "name": "Asteria"},
      {"id": "aura-2-luna-en",    "name": "Luna"},
      {"id": "aura-2-stella-en",  "name": "Stella"},
      {"id": "aura-2-zeus-en",    "name": "Zeus"},
      {"id": "aura-2-orion-en",   "name": "Orion"},
      {"id": "aura-2-thalia-en",  "name": "Thalia"},
    ]

@router.post("/n8n/{action}")
async def n8n_trigger(action: str, payload: dict):
    """Direct local webhooks trigger API entry"""
    return await trigger_n8n(action.upper(), payload)

@router.get("/status")
async def check_status():
    """Heartbeat system component endpoint checker"""
    return {
      "groq":     {"ok": True, "model": settings.GROQ_MODEL},
      "deepgram": {"ok": True, "sdk_version": "v5", "stt_model": settings.DEEPGRAM_STT_MODEL, "tts_voice": settings.DEEPGRAM_TTS_VOICE},
      "n8n":      {
          "email": bool(settings.N8N_EMAIL_WEBHOOK_URL), 
          "github": bool(settings.N8N_GITHUB_WEBHOOK_URL), 
          "slack": bool(settings.N8N_SLACK_WEBHOOK_URL)
      }
    }
