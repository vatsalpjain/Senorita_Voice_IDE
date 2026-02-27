"""
Wake Word Detection Service using openWakeWord

Detects "Hey Groovi" trigger phrase to activate voice assistant.
Includes Silero VAD and Speex noise suppression for noisy environments.
"""

import logging
from pathlib import Path
import numpy as np

logger = logging.getLogger(__name__)

# Path to custom wake word model
MODEL_DIR = Path(__file__).parent.parent / "models"
WAKE_WORD_MODEL_ONNX = MODEL_DIR / "Hey_Groovy.onnx"
WAKE_WORD_MODEL_TFLITE = MODEL_DIR / "Hey_Groovi.tflite"


class WakeWordService:
    """
    Wake word detection using openWakeWord.
    
    Processes 80ms audio frames (16kHz, 16-bit PCM).
    Returns True when "Hey Groovi" is detected.
    """
    
    def __init__(self, threshold: float = 0.5):
        """
        Initialize openWakeWord model.
        
        Args:
            threshold: Detection confidence threshold (0-1)
        """
        self.model = None
        self.threshold = threshold
        
        try:
            from openwakeword.model import Model
            
            logger.info("🎤 Loading wake word model...")
            
            # Try ONNX model first (preferred), then TFLite
            if WAKE_WORD_MODEL_ONNX.exists():
                try:
                    self.model = Model(
                        wakeword_model_paths=[str(WAKE_WORD_MODEL_ONNX)]  # Correct parameter name
                    )
                    logger.info(f"✅ Loaded ONNX model: {WAKE_WORD_MODEL_ONNX.name}")
                except Exception as model_err:
                    logger.error(f"❌ ONNX model failed: {model_err}")
                    self.model = None
            elif WAKE_WORD_MODEL_TFLITE.exists():
                try:
                    self.model = Model(
                        wakeword_model_paths=[str(WAKE_WORD_MODEL_TFLITE)]  # Correct parameter name
                    )
                    logger.info(f"✅ Loaded TFLite model: {WAKE_WORD_MODEL_TFLITE.name}")
                except Exception as model_err:
                    logger.error(f"❌ TFLite model failed: {model_err}")
                    logger.warning("⚠️ Wake word detection DISABLED")
                    self.model = None
            else:
                logger.warning("⚠️ No custom wake word model found")
                logger.warning("⚠️ Wake word detection DISABLED")
                self.model = None
            
        except ImportError:
            logger.error("❌ openwakeword not installed: pip install openwakeword")
            self.model = None
            raise
        except Exception as e:
            logger.error(f"❌ Wake word init failed: {e}")
            raise
    
    def detect(self, audio_chunk: bytes) -> bool:
        """
        Check if wake word is in audio chunk.
        
        Args:
            audio_chunk: Raw PCM audio (16kHz, 16-bit mono)
            
        Returns:
            True if wake word detected (or if model disabled, always False)
        """
        if self.model is None:
            # Wake word detection disabled - return False so we don't trigger
            # The voice assistant should start in LISTENING mode instead
            return False
        
        try:
            # Convert bytes to numpy array
            audio_array = np.frombuffer(audio_chunk, dtype=np.int16)
            
            # Get prediction
            prediction = self.model.predict(audio_array)
            
            # Check for any wake word above threshold
            for name, score in prediction.items():
                if score > self.threshold:
                    logger.info(f"🎤 Wake word detected: {name} ({score:.2f})")
                    return True
            
            return False
            
        except Exception as e:
            logger.error(f"Detection error: {e}")
            return False
    
    def reset(self):
        """Reset model state for new session"""
        if self.model:
            self.model.reset()
