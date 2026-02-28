from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from app.config import settings
from app.api.routes import router as http_router
from app.api.websocket import router as ws_router
from app.api.wake_word import router as wake_word_router
from app.api.n8n_webhooks import router as n8n_router
import logging

logging.basicConfig(level=settings.LOG_LEVEL)
logger = logging.getLogger("senorita")

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Context manager for startup and shutdown logs initialization"""
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
app.include_router(wake_word_router)
app.include_router(n8n_router, prefix="/api")  # n8n webhooks at /api/n8n/*

@app.get("/")
async def root():
    """Returns basic ping checking system uptime component access points status ok."""
    return {"project": "Senorita", "status": "alive", "version": "1.0.0"}

@app.get("/health")
async def health():
    """Base API server liveness root validator component"""
    return {"status": "ok"}
