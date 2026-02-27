"""
Wake Word Detection Test Script (Lightweight - No PyTorch)

Tests the Senorita wake word ONNX model by listening to microphone input
and printing "Wake word detected!" when the wake word is heard.

Uses ONNX Runtime for inference - no heavy PyTorch dependency.

Usage:
    python test_wake_word.py
    python test_wake_word.py --threshold 0.6

Requirements:
    pip install onnxruntime numpy sounddevice librosa
"""

import sys
import argparse
from pathlib import Path

import numpy as np

# ═══════════════════════════════════════════════════════════════
# CONFIGURATION (must match training config from Wakeword.py)
# ═══════════════════════════════════════════════════════════════

SAMPLE_RATE = 16000
CLIP_DURATION = 1.0
CLIP_SAMPLES = int(SAMPLE_RATE * CLIP_DURATION)  # 16000 samples

# Mel spectrogram settings
N_MELS = 40
N_FFT = 512
HOP_LENGTH = 160
WIN_LENGTH = 400

# Path to ONNX model
MODEL_PATH = Path(__file__).parent.parent / "app" / "models" / "senorita_wakeword.onnx"


class WakeWordDetector:
    """
    Lightweight wake word detector using ONNX Runtime.
    No PyTorch dependency - uses librosa for mel spectrogram extraction.
    """
    
    def __init__(self, threshold: float = 0.7):
        """
        Initialize the ONNX model.
        
        Args:
            threshold: Detection confidence threshold (0-1)
        """
        self.threshold = threshold
        self.session = None
        self.audio_buffer = np.zeros(CLIP_SAMPLES, dtype=np.float32)
        
        self._load_model()
    
    def _load_model(self):
        """Load the ONNX model using ONNX Runtime."""
        try:
            import onnxruntime as ort
            
            if not MODEL_PATH.exists():
                print(f"❌ Model not found: {MODEL_PATH}")
                sys.exit(1)
            
            print(f"🎤 Loading ONNX model: {MODEL_PATH.name}")
            
            # Use CPU provider (lightweight)
            self.session = ort.InferenceSession(
                str(MODEL_PATH),
                providers=['CPUExecutionProvider']
            )
            
            # Get input/output names
            self.input_name = self.session.get_inputs()[0].name
            self.output_name = self.session.get_outputs()[0].name
            
            print("✅ Model loaded successfully!")
            print(f"   Input: {self.input_name} {self.session.get_inputs()[0].shape}")
            print(f"   Output: {self.output_name}")
            
        except ImportError:
            print("❌ onnxruntime not installed!")
            print("   Run: pip install onnxruntime")
            sys.exit(1)
        except Exception as e:
            print(f"❌ Failed to load model: {e}")
            sys.exit(1)
    
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
        return 1.0 / (1.0 + np.exp(-x))
    
    def detect(self, audio_chunk: np.ndarray) -> tuple:
        """
        Process audio chunk and check for wake word.
        
        Args:
            audio_chunk: New audio samples (float32)
            
        Returns:
            (detected: bool, probability: float)
        """
        # Update rolling buffer
        chunk_len = len(audio_chunk)
        self.audio_buffer = np.concatenate([
            self.audio_buffer[chunk_len:],
            audio_chunk
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
            return detected, prob
            
        except Exception as e:
            print(f"\nDetection error: {e}")
            return False, 0.0
    
    def reset(self):
        """Reset audio buffer."""
        self.audio_buffer = np.zeros(CLIP_SAMPLES, dtype=np.float32)


def run_detection(threshold: float = 0.7):
    """Main detection loop using sounddevice."""
    try:
        import sounddevice as sd
    except ImportError:
        print("❌ sounddevice not installed!")
        print("   Run: pip install sounddevice")
        sys.exit(1)
    
    # Initialize detector
    detector = WakeWordDetector(threshold=threshold)
    
    print("\n" + "=" * 50)
    print("🎧 Listening for wake word...")
    print(f"   Say 'Senorita' to trigger detection")
    print(f"   Threshold: {threshold}")
    print("   Press Ctrl+C to stop")
    print("=" * 50 + "\n")
    
    # Cooldown counter to avoid repeated triggers
    cooldown = 0
    
    def audio_callback(indata, frames, time_info, status):
        nonlocal cooldown
        
        if status:
            print(f"Audio status: {status}")
        
        # Get mono audio
        audio = indata[:, 0].astype(np.float32)
        
        # Skip if in cooldown
        if cooldown > 0:
            cooldown -= 1
            return
        
        # Run detection
        detected, prob = detector.detect(audio)
        
        # Visual feedback
        bar_len = int(prob * 40)
        bar = "█" * bar_len + "░" * (40 - bar_len)
        
        if detected:
            print(f"\r  [{bar}] {prob:.2f} 🔴 WAKE WORD DETECTED!")
            cooldown = 15  # ~1.5 seconds cooldown
            detector.reset()
        else:
            print(f"\r  [{bar}] {prob:.2f}  ", end="", flush=True)
    
    try:
        # Start audio stream
        with sd.InputStream(
            samplerate=SAMPLE_RATE,
            channels=1,
            blocksize=int(SAMPLE_RATE * 0.1),  # 100ms chunks
            dtype='float32',
            callback=audio_callback
        ):
            print("  Microphone active...\n")
            while True:
                sd.sleep(100)
                
    except KeyboardInterrupt:
        print("\n\n👋 Stopped.")


def main():
    """Entry point."""
    parser = argparse.ArgumentParser(
        description="Senorita Wake Word Detection (ONNX Runtime)"
    )
    parser.add_argument(
        "--threshold", "-t",
        type=float,
        default=0.7,
        help="Detection threshold (0-1, default: 0.7)"
    )
    args = parser.parse_args()
    
    print("\n" + "=" * 50)
    print("   Senorita Wake Word Detection Test")
    print("   (Lightweight - ONNX Runtime)")
    print("=" * 50 + "\n")
    
    run_detection(threshold=args.threshold)


if __name__ == "__main__":
    main()
