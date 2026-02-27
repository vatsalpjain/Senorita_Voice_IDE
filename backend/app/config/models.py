"""
SpellCode Voice AI - Type Models
Complete type definitions using Pydantic
"""

from enum import Enum
from typing import Optional, List, Dict, Any, Callable
from pydantic import BaseModel, Field
from datetime import datetime


class VoiceState(str, Enum):
    """Voice system states"""
    IDLE = "idle"
    LISTENING = "listening"
    PROCESSING = "processing"
    SPEAKING = "speaking"
    ERROR = "error"


class TranscriptionStatus(str, Enum):
    """Transcription status"""
    STARTED = "started"
    INTERIM = "interim"
    FINAL = "final"
    ERROR = "error"


class SpeechStatus(str, Enum):
    """Speech synthesis status"""
    QUEUED = "queued"
    GENERATING = "generating"
    PLAYING = "playing"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    ERROR = "error"


class VoiceConfig(BaseModel):
    """Configuration for Voice AI system"""
    deepgram_api_key: str
    llm_model: str = "llama-3.3-70b-versatile"
    system_prompt: str = "You are SpellCode, a helpful voice coding assistant. Please reply with short and conversational sentences without coding blocks."
    stt_model: str = "nova-2"
    tts_model: str = "aura-asteria-en"
    language: str = "en-US"
    interim_results: bool = True
    punctuate: bool = True
    smart_format: bool = True
    voice_id: str = "asteria"
    enable_vad: bool = True
    silence_timeout: int = 1000  # milliseconds
    endpointing_ms: int = 300
    interruption_enabled: bool = True
    max_queue_size: int = 10
    sample_rate: int = 16000
    channels: int = 1
    encoding: str = "linear16"


class Word(BaseModel):
    """Word with timing information"""
    word: str
    start: float
    end: float
    confidence: float
    punctuated_word: Optional[str] = None


class TranscriptionMetadata(BaseModel):
    """Metadata for transcription"""
    words: Optional[List[Word]] = None
    duration: Optional[float] = None
    channel: Optional[int] = None


class TranscriptionResult(BaseModel):
    """Transcription result from STT"""
    text: str
    is_final: bool
    confidence: float
    timestamp: float
    metadata: Optional[TranscriptionMetadata] = None


class VoiceSettings(BaseModel):
    """Voice synthesis settings"""
    speed: float = 1.0
    pitch: float = 1.0
    volume: float = 1.0


class SpeechRequest(BaseModel):
    """Request for speech synthesis"""
    id: str
    text: str
    priority: int = 0
    timestamp: float
    interruptible: bool = True
    voice_settings: Optional[VoiceSettings] = None


class SpeechResult(BaseModel):
    """Result of speech synthesis"""
    id: str
    status: SpeechStatus
    audio_data: Optional[bytes] = None
    duration: Optional[float] = None
    error: Optional[str] = None
    started_at: Optional[float] = None
    completed_at: Optional[float] = None


class VoiceStateData(BaseModel):
    """Current state of voice system"""
    current_state: VoiceState
    is_listening: bool = False
    is_speaking: bool = False
    is_processing: bool = False
    last_transcription: Optional[TranscriptionResult] = None
    last_speech: Optional[SpeechResult] = None
    error: Optional[str] = None
    session_start_time: Optional[float] = None
    total_transcriptions: int = 0
    total_speeches: int = 0
    speech_queue_size: int = 0


class STTConfig(BaseModel):
    """Configuration for STT service"""
    model: str = "nova-2"
    language: str = "en-US"
    interim_results: bool = True
    punctuate: bool = True
    smart_format: bool = True
    profanity_filter: bool = False
    endpointing: int = 300
    vad_turnoff: int = 1000
    encoding: str = "linear16"
    sample_rate: int = 16000
    channels: int = 1


class TTSConfig(BaseModel):
    """Configuration for TTS service"""
    model: str = "aura-asteria-en"
    voice: str = "asteria"
    encoding: Optional[str] = None
    sample_rate: int = 24000
    container: str = "wav"


class AudioChunk(BaseModel):
    """Audio data chunk"""
    data: bytes
    timestamp: float
    sample_rate: int
    channels: int = 1


class SessionStats(BaseModel):
    """Statistics for voice session"""
    duration: float
    total_transcriptions: int
    total_speeches: int
    average_confidence: Optional[float] = None


class StateHistoryEntry(BaseModel):
    """Entry in state history"""
    state: VoiceState
    timestamp: float


class QueueStatus(BaseModel):
    """Status of speech queue"""
    queue_size: int
    current_speech: Optional[SpeechRequest] = None
    is_generating: bool = False
    is_playing: bool = False