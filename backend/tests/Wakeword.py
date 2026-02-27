"""
Wakeword Detection Model — "Senorita"

PyTorch GRU wakeword detector. Works on Google Colab with GPU.
Auto-generates training data using TTS + Speech Commands dataset.

USAGE (Colab):
  1. Set MODE = "generate" → creates positive + negative training data
  2. Set MODE = "train"    → trains the GRU model on GPU
  3. Model saves to models/senorita_wakeword.pth
"""

# ╔══════════════════════════════════════════════════════════════╗
# ║  SET MODE HERE                                               ║
# ║  "generate" — create training data (TTS + Speech Commands)   ║
# ║  "train"    — train the model on GPU                         ║
# ║  "infer"    — live detection (local only, needs mic)         ║
# ╚══════════════════════════════════════════════════════════════╝

MODE = "generate"     # <── change this: "generate" → "train"
THRESHOLD = 0.7       # for inference mode

# ═══════════════════════════════════════════════════════════════
# IMPORTS
# ═══════════════════════════════════════════════════════════════

import os
import random
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import torchaudio
import torchaudio.transforms as T
from torch.utils.data import DataLoader, Dataset, random_split

# ═══════════════════════════════════════════════════════════════
# CONFIGURATION
# ═══════════════════════════════════════════════════════════════

SAMPLE_RATE = 16000
CLIP_DURATION = 1.0
CLIP_SAMPLES = int(SAMPLE_RATE * CLIP_DURATION)

N_MELS = 40
N_FFT = 512
HOP_LENGTH = 160
WIN_LENGTH = 400

GRU_HIDDEN = 64
GRU_LAYERS = 2
DROPOUT = 0.3

BATCH_SIZE = 32
LEARNING_RATE = 1e-3
MAX_EPOCHS = 100
PATIENCE = 10

DATA_DIR = Path("data")
POSITIVE_DIR = DATA_DIR / "senorita"
NEGATIVE_DIR = DATA_DIR / "negative"
MODEL_DIR = Path("models")
MODEL_PATH = MODEL_DIR / "senorita_wakeword.pth"

DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")

print(f"PyTorch {torch.__version__} | torchaudio {torchaudio.__version__} | Device: {DEVICE}")
if DEVICE.type == "cuda":
    try:
        vram = torch.cuda.get_device_properties(0).total_memory / 1024**3
    except AttributeError:
        vram = 0
    print(f"GPU: {torch.cuda.get_device_name(0)} | VRAM: {vram:.1f} GB")


# ═══════════════════════════════════════════════════════════════
# FEATURE EXTRACTION
# ═══════════════════════════════════════════════════════════════

def build_mel_transform(augment=False):
    layers = [
        T.MelSpectrogram(
            sample_rate=SAMPLE_RATE, n_fft=N_FFT,
            hop_length=HOP_LENGTH, win_length=WIN_LENGTH, n_mels=N_MELS,
        ),
        T.AmplitudeToDB(stype="power", top_db=80),
    ]
    if augment:
        layers += [T.FrequencyMasking(freq_mask_param=5), T.TimeMasking(time_mask_param=10)]
    return nn.Sequential(*layers)


def load_and_preprocess(filepath):
    waveform, sr = torchaudio.load(str(filepath))
    if waveform.shape[0] > 1:
        waveform = waveform.mean(dim=0, keepdim=True)
    if sr != SAMPLE_RATE:
        waveform = T.Resample(sr, SAMPLE_RATE)(waveform)
    if waveform.shape[1] < CLIP_SAMPLES:
        waveform = torch.nn.functional.pad(waveform, (0, CLIP_SAMPLES - waveform.shape[1]))
    else:
        waveform = waveform[:, :CLIP_SAMPLES]
    return waveform


# ═══════════════════════════════════════════════════════════════
# DATASET
# ═══════════════════════════════════════════════════════════════

class WakewordDataset(Dataset):
    def __init__(self, positive_dir, negative_dir, augment=False):
        self.files = []
        self.mel_transform = build_mel_transform(augment=augment)

        for f in sorted(Path(positive_dir).glob("*.wav")):
            self.files.append((f, 1.0))
        for f in sorted(Path(negative_dir).glob("*.wav")):
            self.files.append((f, 0.0))

        if not self.files:
            raise FileNotFoundError(
                f"No .wav files found!\n"
                f"  Positive: {Path(positive_dir).resolve()}\n"
                f"  Negative: {Path(negative_dir).resolve()}\n"
                f"Run with MODE = 'generate' first."
            )
        pos = sum(1 for _, label in self.files if label == 1.0)
        print(f"  Dataset: {pos} positive, {len(self.files) - pos} negative")

    def __len__(self):
        return len(self.files)

    def __getitem__(self, idx):
        filepath, label = self.files[idx]
        waveform = load_and_preprocess(filepath)
        mel = self.mel_transform(waveform).squeeze(0)
        return mel, torch.tensor(label, dtype=torch.float32)


# ═══════════════════════════════════════════════════════════════
# MODEL — Bidirectional GRU
# ═══════════════════════════════════════════════════════════════

class WakewordGRU(nn.Module):
    """
    MelSpec → BatchNorm → BiGRU → Dropout → Linear → logit
    Input:  (batch, n_mels, time_steps)
    Output: (batch, 1)
    """
    def __init__(self, n_mels=N_MELS, hidden_size=GRU_HIDDEN,
                 num_layers=GRU_LAYERS, dropout=DROPOUT):
        super().__init__()
        self.bn = nn.BatchNorm1d(n_mels)
        self.gru = nn.GRU(
            input_size=n_mels, hidden_size=hidden_size,
            num_layers=num_layers, batch_first=True,
            bidirectional=True,
            dropout=dropout if num_layers > 1 else 0.0,
        )
        self.dropout = nn.Dropout(dropout)
        self.fc = nn.Linear(hidden_size * 2, 1)

    def forward(self, x):
        x = self.bn(x)
        x = x.permute(0, 2, 1)
        output, _ = self.gru(x)
        x = self.dropout(output[:, -1, :])
        return self.fc(x)


# ═══════════════════════════════════════════════════════════════
# DATA GENERATION (for Colab — no mic needed)
# ═══════════════════════════════════════════════════════════════

def generate_data(num_positive=50, num_negative=200):
    """
    Auto-generate training data:
      - Positive: TTS "Senorita" with pitch/speed variations using gTTS
      - Negative: Random words from torchaudio Speech Commands dataset
    """
    print("=" * 60)
    print("  GENERATING TRAINING DATA")
    print("=" * 60)

    POSITIVE_DIR.mkdir(parents=True, exist_ok=True)
    NEGATIVE_DIR.mkdir(parents=True, exist_ok=True)

    # ── POSITIVE SAMPLES via gTTS ──
    print(f"\n  📢 Generating {num_positive} positive samples ('Senorita') via TTS...")

    try:
        from gtts import gTTS
    except ImportError:
        print("  Installing gTTS...")
        os.system("pip install -q gTTS")
        from gtts import gTTS

    # Variations of "Senorita" for diverse training data
    phrases = [
        "senorita", "señorita", "senorita!", "hey senorita",
        "senorita senorita", "ok senorita",
    ]

    # Speed and pitch augmentation via torchaudio
    count = 0
    for i in range(num_positive):
        phrase = phrases[i % len(phrases)]
        tmp_mp3 = f"/tmp/tts_temp_{i}.mp3"
        tmp_wav = f"/tmp/tts_temp_{i}.wav"

        try:
            tts = gTTS(text=phrase, lang="en", slow=(i % 3 == 0))
            tts.save(tmp_mp3)

            # Convert mp3 → wav at 16kHz using torchaudio
            waveform, sr = torchaudio.load(tmp_mp3)
            if sr != SAMPLE_RATE:
                waveform = T.Resample(sr, SAMPLE_RATE)(waveform)
            if waveform.shape[0] > 1:
                waveform = waveform.mean(dim=0, keepdim=True)

            # Apply random augmentations
            # Speed perturbation
            speed_factor = random.uniform(0.85, 1.15)
            if speed_factor != 1.0:
                effects = [["tempo", str(speed_factor)]]
                try:
                    waveform, _ = torchaudio.sox_effects.apply_effects_tensor(
                        waveform, SAMPLE_RATE, effects
                    )
                except Exception:
                    pass  # sox not available, skip speed aug

            # Add slight noise
            noise_level = random.uniform(0.001, 0.01)
            noise = torch.randn_like(waveform) * noise_level
            waveform = waveform + noise

            # Pad/truncate to fixed length
            if waveform.shape[1] < CLIP_SAMPLES:
                # Random padding position
                pad_total = CLIP_SAMPLES - waveform.shape[1]
                pad_left = random.randint(0, pad_total)
                pad_right = pad_total - pad_left
                waveform = torch.nn.functional.pad(waveform, (pad_left, pad_right))
            else:
                start = random.randint(0, max(0, waveform.shape[1] - CLIP_SAMPLES))
                waveform = waveform[:, start:start + CLIP_SAMPLES]

            # Volume variation
            volume = random.uniform(0.5, 1.5)
            waveform = waveform * volume
            waveform = torch.clamp(waveform, -1.0, 1.0)

            out_path = POSITIVE_DIR / f"senorita_{count:04d}.wav"
            torchaudio.save(str(out_path), waveform, SAMPLE_RATE)
            count += 1

            # Cleanup
            if os.path.exists(tmp_mp3):
                os.remove(tmp_mp3)

        except Exception as e:
            print(f"    ⚠ Sample {i} failed: {e}")
            continue

        if (i + 1) % 10 == 0:
            print(f"    ✓ {i + 1}/{num_positive} positive samples")

    print(f"  ✅ Generated {count} positive samples")

    # ── NEGATIVE SAMPLES from Speech Commands ──
    print(f"\n  📥 Downloading negative samples from Speech Commands dataset...")

    try:
        dataset = torchaudio.datasets.SPEECHCOMMANDS(
            root="./speech_commands_data",
            download=True,
            subset="training",
        )

        # Randomly sample negative examples
        indices = list(range(len(dataset)))
        random.shuffle(indices)

        neg_count = 0
        for idx in indices:
            if neg_count >= num_negative:
                break

            waveform, sr, label, *_ = dataset[idx]

            # Skip any label that sounds like "senorita"
            if "sen" in label.lower():
                continue

            if sr != SAMPLE_RATE:
                waveform = T.Resample(sr, SAMPLE_RATE)(waveform)
            if waveform.shape[0] > 1:
                waveform = waveform.mean(dim=0, keepdim=True)

            # Pad/truncate
            if waveform.shape[1] < CLIP_SAMPLES:
                pad = CLIP_SAMPLES - waveform.shape[1]
                waveform = torch.nn.functional.pad(waveform, (0, pad))
            else:
                waveform = waveform[:, :CLIP_SAMPLES]

            out_path = NEGATIVE_DIR / f"negative_{neg_count:04d}.wav"
            torchaudio.save(str(out_path), waveform, SAMPLE_RATE)
            neg_count += 1

            if neg_count % 50 == 0:
                print(f"    ✓ {neg_count}/{num_negative} negative samples")

        print(f"  ✅ Generated {neg_count} negative samples")

    except Exception as e:
        print(f"  ⚠ Speech Commands download failed: {e}")
        print("  Generating synthetic negative samples instead...")

        # Fallback: generate noise + silence as negatives
        for i in range(num_negative):
            if random.random() < 0.5:
                # Random noise
                waveform = torch.randn(1, CLIP_SAMPLES) * random.uniform(0.01, 0.1)
            else:
                # Near silence
                waveform = torch.randn(1, CLIP_SAMPLES) * 0.001

            out_path = NEGATIVE_DIR / f"negative_{i:04d}.wav"
            torchaudio.save(str(out_path), waveform, SAMPLE_RATE)

        print(f"  ✅ Generated {num_negative} synthetic negative samples")

    # Summary
    pos_total = len(list(POSITIVE_DIR.glob("*.wav")))
    neg_total = len(list(NEGATIVE_DIR.glob("*.wav")))
    print(f"\n{'=' * 60}")
    print(f"  DATA GENERATION COMPLETE")
    print(f"  Positive: {pos_total} | Negative: {neg_total}")
    print(f"  Location: {DATA_DIR.resolve()}")
    print(f"\n  ➡ Now set MODE = 'train' and run again!")
    print(f"{'=' * 60}")


# ═══════════════════════════════════════════════════════════════
# TRAINING
# ═══════════════════════════════════════════════════════════════

def train_model():
    print("=" * 60)
    print(f"  TRAINING WAKEWORD MODEL on {DEVICE}")
    print("=" * 60)

    print("\n  Loading dataset...")
    dataset = WakewordDataset(POSITIVE_DIR, NEGATIVE_DIR, augment=True)

    val_size = max(1, int(len(dataset) * 0.2))
    train_size = len(dataset) - val_size
    train_set, val_set = random_split(
        dataset, [train_size, val_size],
        generator=torch.Generator().manual_seed(42),
    )
    print(f"  Split: {train_size} train / {val_size} val")

    train_loader = DataLoader(train_set, batch_size=BATCH_SIZE, shuffle=True,
                              num_workers=2, pin_memory=True)
    val_loader = DataLoader(val_set, batch_size=BATCH_SIZE, shuffle=False,
                            num_workers=2, pin_memory=True)

    model = WakewordGRU().to(DEVICE)
    params = sum(p.numel() for p in model.parameters())
    print(f"  Parameters: {params:,}")

    criterion = nn.BCEWithLogitsLoss()
    optimizer = torch.optim.AdamW(model.parameters(), lr=LEARNING_RATE, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.OneCycleLR(
        optimizer, max_lr=LEARNING_RATE,
        epochs=MAX_EPOCHS, steps_per_epoch=len(train_loader),
    )

    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    best_val_loss = float("inf")
    patience_ctr = 0

    print(f"\n  {'Ep':>4}  {'TrLoss':>8}  {'VaLoss':>8}  {'VaAcc':>7}  {'LR':>10}")
    print(f"  {'─' * 45}")

    for epoch in range(1, MAX_EPOCHS + 1):
        model.train()
        t_loss = 0.0
        for mels, labels in train_loader:
            mels, labels = mels.to(DEVICE), labels.to(DEVICE)
            optimizer.zero_grad()
            loss = criterion(model(mels).squeeze(-1), labels)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            scheduler.step()
            t_loss += loss.item() * mels.size(0)
        t_loss /= train_size

        model.eval()
        v_loss, correct = 0.0, 0
        with torch.no_grad():
            for mels, labels in val_loader:
                mels, labels = mels.to(DEVICE), labels.to(DEVICE)
                logits = model(mels).squeeze(-1)
                v_loss += criterion(logits, labels).item() * mels.size(0)
                correct += ((torch.sigmoid(logits) > 0.5).float() == labels).sum().item()
        v_loss /= val_size
        v_acc = correct / val_size
        lr = optimizer.param_groups[0]["lr"]

        print(f"  {epoch:4d}  {t_loss:8.4f}  {v_loss:8.4f}  {v_acc:6.1%}  {lr:10.6f}")

        if v_loss < best_val_loss:
            best_val_loss = v_loss
            patience_ctr = 0
            torch.save({
                "epoch": epoch,
                "model_state_dict": model.state_dict(),
                "val_loss": v_loss, "val_acc": v_acc,
                "config": dict(
                    n_mels=N_MELS, n_fft=N_FFT, hop_length=HOP_LENGTH,
                    win_length=WIN_LENGTH, gru_hidden=GRU_HIDDEN,
                    gru_layers=GRU_LAYERS, dropout=DROPOUT,
                    sample_rate=SAMPLE_RATE, clip_samples=CLIP_SAMPLES,
                ),
            }, str(MODEL_PATH))
        else:
            patience_ctr += 1
            if patience_ctr >= PATIENCE:
                print(f"\n  ⏹ Early stopping at epoch {epoch}")
                break

    # ── Export to ONNX ──
    print(f"\n  📦 Exporting to ONNX...")
    onnx_path = MODEL_DIR / "senorita_wakeword.onnx"
    try:
        # Install onnxscript if missing (required by PyTorch 2.10+)
        try:
            import onnxscript
        except ImportError:
            print("  Installing onnxscript...")
            os.system("pip install -q onnxscript onnx")
            import onnxscript
        # Reload best checkpoint
        best_ckpt = torch.load(str(MODEL_PATH), map_location="cpu", weights_only=True)
        export_model = WakewordGRU(dropout=0.0)  # no dropout for inference
        export_model.load_state_dict(best_ckpt["model_state_dict"])
        export_model.eval()

        # Dummy input: (batch=1, n_mels=40, time_steps=101)
        dummy = torch.randn(1, N_MELS, CLIP_SAMPLES // HOP_LENGTH + 1)

        torch.onnx.export(
            export_model, dummy, str(onnx_path),
            input_names=["mel_input"],
            output_names=["prediction"],
            dynamic_axes={"mel_input": {0: "batch"}, "prediction": {0: "batch"}},
            opset_version=17,
        )
        onnx_size = onnx_path.stat().st_size / 1024
        print(f"  ✅ ONNX saved: {onnx_path.resolve()} ({onnx_size:.1f} KB)")
    except Exception as e:
        print(f"  ⚠ ONNX export failed: {e}")
        print(f"  You can still use the .pth model with PyTorch directly.")

    print(f"\n{'=' * 60}")
    print(f"  TRAINING COMPLETE — best val loss: {best_val_loss:.4f}")
    print(f"  PyTorch model: {MODEL_PATH.resolve()}")
    print(f"  ONNX model:    {onnx_path.resolve()}")
    print(f"{'=' * 60}")


# ═══════════════════════════════════════════════════════════════
# INFERENCE (local only — needs mic)
# ═══════════════════════════════════════════════════════════════

def run_inference(threshold=0.7):
    try:
        import sounddevice as sd
    except ImportError:
        print("❌ sounddevice not available — inference needs a local mic.")
        return

    if not MODEL_PATH.exists():
        print(f"❌ No model at {MODEL_PATH}. Train first.")
        return

    print("=" * 60)
    print(f"  LIVE DETECTION — Threshold: {threshold}")
    print("=" * 60)

    ckpt = torch.load(str(MODEL_PATH), map_location=DEVICE, weights_only=True)
    cfg = ckpt["config"]
    model = WakewordGRU(
        n_mels=cfg["n_mels"], hidden_size=cfg["gru_hidden"],
        num_layers=cfg["gru_layers"], dropout=0.0,
    ).to(DEVICE)
    model.load_state_dict(ckpt["model_state_dict"])
    model.eval()

    mel_tf = build_mel_transform(augment=False).to(DEVICE)
    print(f"  Loaded (epoch {ckpt['epoch']}, acc={ckpt['val_acc']:.1%})")
    print("  🎤 Listening... Ctrl+C to stop\n")

    buf = np.zeros(CLIP_SAMPLES, dtype=np.float32)
    cd = 0

    def cb(indata, frames, ti, status):
        nonlocal buf, cd
        new = indata[:, 0]
        buf = np.concatenate([buf[len(new):], new])
        if cd > 0:
            cd -= 1
            return
        with torch.no_grad():
            prob = torch.sigmoid(model(mel_tf(
                torch.from_numpy(buf).unsqueeze(0).to(DEVICE)
            ))).item()
        bar = "█" * int(prob * 40) + "░" * (40 - int(prob * 40))
        tag = "🔴 DETECTED!" if prob >= threshold else ""
        print(f"\r  [{bar}] {prob:.2f} {tag}  ", end="", flush=True)
        if prob >= threshold:
            cd = 15
            print()

    try:
        with sd.InputStream(samplerate=SAMPLE_RATE, channels=1,
                            blocksize=int(SAMPLE_RATE * 0.1),
                            dtype="float32", callback=cb):
            while True:
                time.sleep(0.1)
    except KeyboardInterrupt:
        print("\n  Stopped.")


# ═══════════════════════════════════════════════════════════════
# RUN
# ═══════════════════════════════════════════════════════════════

def _is_notebook():
    try:
        from IPython import get_ipython
        return get_ipython().__class__.__name__ in ("ZMQInteractiveShell", "Shell")
    except Exception:
        return False


if _is_notebook():
    print(f"\n▶ MODE = '{MODE}'\n")
    if MODE == "generate":
        generate_data(num_positive=50, num_negative=200)
    elif MODE == "train":
        train_model()
    elif MODE == "infer":
        run_inference(threshold=THRESHOLD)
    else:
        print(f"Unknown MODE '{MODE}'. Use 'generate', 'train', or 'infer'.")

elif __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Wakeword — 'Senorita'")
    sub = parser.add_subparsers(dest="command")
    sub.add_parser("generate")
    sub.add_parser("train")
    ip = sub.add_parser("infer")
    ip.add_argument("--threshold", type=float, default=0.7)
    args = parser.parse_args()

    cmds = {"generate": lambda: generate_data(), "train": train_model,
            "infer": lambda: run_inference(args.threshold)}
    if args.command in cmds:
        cmds[args.command]()
    else:
        parser.print_help()