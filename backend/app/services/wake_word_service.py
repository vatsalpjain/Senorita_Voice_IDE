"""
Wake Word Detection Service (Lightweight - ONNX Runtime)

Detects "Senorita" wake word using custom trained GRU model.
Uses ONNX Runtime for inference - no PyTorch dependency.

The model expects mel spectrograms with these parameters:
- Sample rate: 16kHz
- n_mels: 40
- n_fft: 512
- hop_length: 160
- win_length: 400
- Clip duration: 1 second (16000 samples)
"""

import logging
from pathlib import Path
from typing import Tuple

import numpy as np

logger = logging.getLogger(__name__)

# ═══════════════════════════════════════════════════════════════
# CONFIGURATION (must match training config)
# ═══════════════════════════════════════════════════════════════

SAMPLE_RATE = 16000
CLIP_DURATION = 1.0
CLIP_SAMPLES = int(SAMPLE_RATE * CLIP_DURATION)  # 16000 samples

# Mel spectrogram settings
N_MELS = 40
N_FFT = 512
HOP_LENGTH = 160
WIN_LENGTH = 400

# Default detection threshold
DEFAULT_THRESHOLD = 0.3

# Path to ONNX model
MODEL_PATH = Path(__file__).parent.parent / "models" / "senorita_wakeword.onnx"


class WakeWordService:
    """
    Lightweight wake word detector using ONNX Runtime.
    No PyTorch dependency - uses librosa for mel spectrogram extraction.
    
    Usage:
        service = WakeWordService(threshold=0.5)
        
        # Feed audio chunks continuously
        detected, prob = service.process_audio(audio_chunk)
        if detected:
            print("Wake word detected!")
            service.reset()  # Reset after detection
    """
    
    def __init__(self, threshold: float = DEFAULT_THRESHOLD):
        """
        Initialize the ONNX model.
        
        Args:
            threshold: Detection confidence threshold (0-1)
        """
        self.threshold = threshold
        self.session = None
        self.input_name = None
        self.output_name = None
        self.audio_buffer = np.zeros(CLIP_SAMPLES, dtype=np.float32)
        self._model_loaded = False
        
        self._load_model()
    
    def _load_model(self):
        """Load the ONNX model using ONNX Runtime."""
        try:
            import onnxruntime as ort
            
            if not MODEL_PATH.exists():
                logger.warning(f"Wake word model not found: {MODEL_PATH}")
                logger.warning("Wake word detection will be disabled")
                return
            
            logger.info(f"Loading wake word model: {MODEL_PATH.name}")
            
            # Use CPU provider (lightweight)
            self.session = ort.InferenceSession(
                str(MODEL_PATH),
                providers=['CPUExecutionProvider']
            )
            
            # Get input/output names
            self.input_name = self.session.get_inputs()[0].name
            self.output_name = self.session.get_outputs()[0].name
            
            self._model_loaded = True
            logger.info(f"✅ Wake word model loaded successfully")
            logger.info(f"   Input: {self.input_name} {self.session.get_inputs()[0].shape}")
            
        except ImportError:
            logger.error("onnxruntime not installed! Run: pip install onnxruntime")
            self._model_loaded = False
        except Exception as e:
            logger.error(f"Failed to load wake word model: {e}")
            self._model_loaded = False
    
    @property
    def is_available(self) -> bool:
        """Check if wake word detection is available."""
        return self._model_loaded and self.session is not None
    
    def _compute_mel_spectrogram(self, audio: np.ndarray) -> np.ndarray:
        """
        Compute mel spectrogram matching the training pipeline.
        
        Args:
            audio: Audio samples (float32, normalized to [-1, 1])
            
        Returns:
            Mel spectrogram in dB scale (n_mels, time_steps)
        """
        import librosa
        
        # Compute mel spectrogram
        mel = librosa.feature.melspectrogram(
            y=audio,
            sr=SAMPLE_RATE,
            n_fft=N_FFT,
            hop_length=HOP_LENGTH,
            win_length=WIN_LENGTH,
            n_mels=N_MELS,
            power=2.0  # Power spectrogram
        )
        
        # Convert to dB (matches torchaudio.transforms.AmplitudeToDB)
        mel_db = librosa.power_to_db(mel, ref=1.0, top_db=80.0)
        
        return mel_db
    
    def _sigmoid(self, x: float) -> float:
        """Apply sigmoid activation."""
        return 1.0 / (1.0 + np.exp(-np.clip(x, -500, 500)))
    
    def process_audio(self, audio_chunk: np.ndarray) -> Tuple[bool, float]:
        """
        Process audio chunk and check for wake word.
        
        Args:
            audio_chunk: New audio samples (float32, normalized to [-1, 1])
            
        Returns:
            (detected: bool, probability: float)
        """
        if not self.is_available:
            return False, 0.0
        
        # Update rolling buffer
        chunk_len = len(audio_chunk)
        if chunk_len >= CLIP_SAMPLES:
            # If chunk is larger than buffer, just use the last CLIP_SAMPLES
            self.audio_buffer = audio_chunk[-CLIP_SAMPLES:].astype(np.float32)
        else:
            self.audio_buffer = np.concatenate([
                self.audio_buffer[chunk_len:],
                audio_chunk.astype(np.float32)
            ])
        
        try:
            # Compute mel spectrogram
            mel = self._compute_mel_spectrogram(self.audio_buffer)
            
            # Add batch dimension: (1, n_mels, time_steps)
            mel_input = mel[np.newaxis, :, :].astype(np.float32)
            
            # Run inference
            outputs = self.session.run(
                [self.output_name],
                {self.input_name: mel_input}
            )
            
            # Get logit and apply sigmoid
            logit = outputs[0][0, 0]
            prob = self._sigmoid(logit)
            
            detected = prob >= self.threshold
            return detected, float(prob)
            
        except Exception as e:
            logger.error(f"Wake word detection error: {e}")
            return False, 0.0
    
    def process_audio_bytes(self, audio_bytes: bytes, sample_width: int = 2) -> Tuple[bool, float]:
        """
        Process raw PCM audio bytes.
        
        Args:
            audio_bytes: Raw PCM audio (16kHz, mono)
            sample_width: Bytes per sample (2 for 16-bit, 4 for 32-bit)
            
        Returns:
            (detected: bool, probability: float)
        """
        if sample_width == 2:
            # 16-bit PCM
            audio = np.frombuffer(audio_bytes, dtype=np.int16).astype(np.float32) / 32768.0
        elif sample_width == 4:
            # 32-bit float
            audio = np.frombuffer(audio_bytes, dtype=np.float32)
        else:
            logger.error(f"Unsupported sample width: {sample_width}")
            return False, 0.0
        
        return self.process_audio(audio)
    
    def reset(self):
        """Reset audio buffer (call after detection to avoid repeated triggers)."""
        self.audio_buffer = np.zeros(CLIP_SAMPLES, dtype=np.float32)
    
    def set_threshold(self, threshold: float):
        """Update detection threshold."""
        self.threshold = max(0.0, min(1.0, threshold))
        logger.info(f"Wake word threshold set to {self.threshold}")


# Singleton instance for easy access
_wake_word_service: WakeWordService | None = None


def get_wake_word_service(threshold: float = DEFAULT_THRESHOLD) -> WakeWordService:
    """Get or create the singleton wake word service."""
    global _wake_word_service
    if _wake_word_service is None:
        _wake_word_service = WakeWordService(threshold=threshold)
    return _wake_word_service
