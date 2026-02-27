"""
╔══════════════════════════════════════════════════════════════╗
║          🌹 SENORITA VOICE AI — TEST & DEMO SCRIPT          ║
║  Runs against a live backend, tests all endpoints + voice AI ║
╚══════════════════════════════════════════════════════════════╝

Usage (backend must be running first):
  python test_voice_ai.py

Modes available in this script:
  1. HTTP Health Check  — tests all REST endpoints
  2. Text Command       — send a typed command through the full WS pipeline
  3. Voice Command (Mic)— record your voice and send through the full WS pipeline
  4. Continuous Convo   — live multi-turn conversation with barge-in support

Extra dep for Test 4 playback:
  pip install pydub
  (also needs ffmpeg on PATH for MP3 decoding)
"""

import asyncio
import json
import sys
import time
import threading
import tempfile
import os
import io
import wave

import httpx
import websockets
import numpy as np

# ── ANSI color codes for rich terminal output ──────────────────────────────────
RESET   = "\033[0m"
BOLD    = "\033[1m"
RED     = "\033[91m"
GREEN   = "\033[92m"
YELLOW  = "\033[93m"
BLUE    = "\033[94m"
MAGENTA = "\033[95m"
CYAN    = "\033[96m"
WHITE   = "\033[97m"
DIM     = "\033[2m"

# ── Backend config (change if running on different host/port) ──────────────────
BASE_URL    = "http://localhost:8000"
WS_URL      = "ws://localhost:8000/ws/voice"
SAMPLE_RATE = 16000   # Hz — matches what Deepgram expects
CHANNELS    = 1       # Mono
RECORD_SECS = 5       # Default recording duration


def log(prefix: str, color: str, message: str):
    """Colored, timestamped log line"""
    ts = time.strftime("%H:%M:%S")
    print(f"{DIM}[{ts}]{RESET} {color}{BOLD}{prefix:<14}{RESET}{WHITE}{message}{RESET}")


def section(title: str):
    """Prints a visual section separator"""
    width = 62
    print(f"\n{CYAN}{'─' * width}{RESET}")
    print(f"{CYAN}{BOLD}  {title}{RESET}")
    print(f"{CYAN}{'─' * width}{RESET}")


# ══════════════════════════════════════════════════════════════
#  PART 1 — HTTP REST ENDPOINT TESTS
# ══════════════════════════════════════════════════════════════

async def test_http_endpoints():
    """Tests all REST API endpoints and prints results"""
    section("1/3  HTTP REST Endpoint Tests")

    async with httpx.AsyncClient(base_url=BASE_URL, timeout=10.0) as client:

        # Root
        log("GET /", GREEN, "Testing root endpoint...")
        try:
            r = await client.get("/")
            data = r.json()
            log("✅ Root", GREEN, f"status={r.status_code}  response={data}")
        except Exception as e:
            log("❌ Root", RED, f"FAILED: {e}")

        # Health
        log("GET /health", GREEN, "Testing health endpoint...")
        try:
            r = await client.get("/health")
            log("✅ Health", GREEN, f"status={r.status_code}  response={r.json()}")
        except Exception as e:
            log("❌ Health", RED, f"FAILED: {e}")

        # Status
        log("GET /api/status", GREEN, "Testing component status endpoint...")
        try:
            r = await client.get("/api/status")
            data = r.json()
            groq_ok    = data.get("groq",     {}).get("ok")
            dg_ok      = data.get("deepgram", {}).get("ok")
            stt_model  = data.get("deepgram", {}).get("stt_model")
            tts_voice  = data.get("deepgram", {}).get("tts_voice")
            log("✅ Status", GREEN, f"Groq={groq_ok} | DG_ok={dg_ok} | STT={stt_model} | TTS={tts_voice}")
        except Exception as e:
            log("❌ Status", RED, f"FAILED: {e}")

        # Voices
        log("GET /api/voices", GREEN, "Testing available TTS voices endpoint...")
        try:
            r = await client.get("/api/voices")
            voices = r.json()
            names = [v["name"] for v in voices]
            log("✅ Voices", GREEN, f"Available: {', '.join(names)}")
        except Exception as e:
            log("❌ Voices", RED, f"FAILED: {e}")

        # TTS via REST
        log("POST /api/tts", GREEN, "Testing TTS audio generation (REST)...")
        try:
            r = await client.post("/api/tts", json={"text": "Hello, I am Senorita. The voice AI is working correctly."})
            if r.status_code == 200:
                size_kb = len(r.content) / 1024
                log("✅ TTS REST", GREEN, f"Audio received: {size_kb:.1f} KB  content-type={r.headers.get('content-type')}")
                # Save to temp so user can open and listen
                tts_file = os.path.join(tempfile.gettempdir(), "senorita_test_tts.mp3")
                with open(tts_file, "wb") as f:
                    f.write(r.content)
                log("   Saved →", YELLOW, f"{tts_file}")
            else:
                log("❌ TTS REST", RED, f"status={r.status_code} body={r.text[:200]}")
        except Exception as e:
            log("❌ TTS REST", RED, f"FAILED: {e}")

        # Text Command via REST
        log("POST /api/command", GREEN, "Testing text command via REST...")
        try:
            r = await client.post("/api/command", json={
                "transcript": "explain what a Python generator is",
                "context": None
            }, timeout=20.0)
            data = r.json()
            action   = data.get("action")
            response = (data.get("llm_response") or "")[:120]
            log("✅ Command", GREEN, f"action={action}")
            log("   LLM→", MAGENTA, f"{response}...")
        except Exception as e:
            log("❌ Command", RED, f"FAILED: {e}")


# ══════════════════════════════════════════════════════════════
#  PART 2 — WEBSOCKET: TEXT COMMAND FLOW
# ══════════════════════════════════════════════════════════════

async def ws_text_command(command: str):
    """
    Sends a typed text command over the /ws/voice pipeline.
    Shows every server event in real-time so you can see the
    full transcript → action → LLM → TTS flow.
    """
    section(f"2/3  WebSocket Text Command Flow")
    log("Command", CYAN, f'"{command}"')

    try:
        async with websockets.connect(WS_URL) as ws:
            # ── Wait for connected ack ─────────────────────────────
            raw = await ws.recv()
            msg = json.loads(raw) if isinstance(raw, str) else None
            if msg:
                log("↙ Server", GREEN, f'type={msg["type"]}  message={msg.get("message", "")}')

            # ── Send text command ──────────────────────────────────
            payload = json.dumps({"type": "text_command", "text": command})
            await ws.send(payload)
            log("↗ Sent", BLUE, f'type=text_command  text="{command}"')

            tts_audio_chunks = []

            # ── Listen for all server events ───────────────────────
            while True:
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=30.0)
                except asyncio.TimeoutError:
                    log("⏱ Timeout", YELLOW, "No more messages received within 30s. Done.")
                    break

                if isinstance(raw, bytes):
                    # Binary = TTS audio bytes
                    tts_audio_chunks.append(raw)
                    log("↙ Audio", MAGENTA, f"Received TTS audio chunk: {len(raw)} bytes")
                    continue

                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    log("↙ ???", RED, f"Non-JSON text: {raw[:100]}")
                    continue

                t = msg.get("type")

                if t == "action":
                    log("↙ Action", CYAN, f'action={msg["action"]}  param="{msg.get("param", "")}"')

                elif t == "llm_chunk":
                    print(f"{MAGENTA}{msg['text']}{RESET}", end="", flush=True)

                elif t == "tts_start":
                    print()  # newline after streamed LLM text
                    log("↙ TTS Start", YELLOW, "Server is generating audio...")

                elif t == "tts_done":
                    total_kb = sum(len(c) for c in tts_audio_chunks) / 1024
                    log("↙ TTS Done", GREEN, f"Total TTS audio: {total_kb:.1f} KB")
                    if tts_audio_chunks:
                        mp3_bytes = b"".join(tts_audio_chunks)
                        # Try inline playback first
                        samples, sr = mp3_bytes_to_numpy(mp3_bytes)
                        if samples is not None:
                            try:
                                import sounddevice as sd
                                log("🔊 Playing", MAGENTA + BOLD, f"Playing {len(samples)/sr:.1f}s of audio...")
                                sd.play(samples, samplerate=sr)
                                sd.wait()   # block until done
                                log("✅ Done", GREEN, "Playback complete")
                            except Exception as e:
                                log("⚠ Playback", YELLOW, f"sounddevice error: {e}")
                        else:
                            audio_file = os.path.join(tempfile.gettempdir(), "senorita_ws_tts.mp3")
                            with open(audio_file, "wb") as f:
                                f.write(mp3_bytes)
                            log("   Saved →", YELLOW, f"{audio_file}  (pip install pydub + ffmpeg for live playback)")
                    break  # Flow complete

                elif t == "error":
                    log("↙ Error", RED, f'{msg.get("message")}')
                    break

                elif t == "n8n_result":
                    log("↙ n8n", CYAN, f'status={msg.get("status")}  action={msg.get("action")}')

                elif t == "instruction":
                    log("↙ Instruction", CYAN, f'{msg.get("instruction")}')

                elif t == "pong":
                    log("↙ Pong", DIM, "heartbeat ok")

                else:
                    log(f"↙ {t}", DIM, str(msg))

    except websockets.ConnectionRefusedError:
        log("❌ WS", RED, "Could not connect — is the backend running on port 8000?")
    except Exception as e:
        log("❌ WS", RED, f"Error: {e}")


# ══════════════════════════════════════════════════════════════
#  PART 3 — WEBSOCKET: LIVE MICROPHONE VOICE FLOW
# ══════════════════════════════════════════════════════════════

def record_microphone(duration: int = RECORD_SECS, sample_rate: int = SAMPLE_RATE) -> bytes:
    """
    Records from the default microphone using sounddevice.
    Returns raw PCM bytes (int16, mono).
    """
    try:
        import sounddevice as sd
    except ImportError:
        log("❌ Mic", RED, "sounddevice not installed. Run: pip install sounddevice")
        return b""

    log("🎙 Record", YELLOW, f"Recording for {duration} seconds... SPEAK NOW!")
    audio = sd.rec(
        int(duration * sample_rate),
        samplerate=sample_rate,
        channels=CHANNELS,
        dtype="int16",
    )
    # Countdown
    for i in range(duration, 0, -1):
        print(f"\r{YELLOW}  ⏱ {i}s remaining...{RESET}   ", end="", flush=True)
        time.sleep(1)
    sd.wait()
    print(f"\r{GREEN}  ✅ Recording complete!          {RESET}")

    # Convert numpy array to raw bytes — Deepgram expects int16 PCM
    return audio.tobytes()


async def ws_voice_command(duration: int = RECORD_SECS):
    """
    Records microphone audio, sends it to the /ws/voice endpoint
    as binary frames + end_audio signal, then prints all server events.
    
    This is the FULL voice pipeline test:
      mic → binary WS frames → STT → command parser → LLM → TTS → audio bytes back
    """
    section("3/3  WebSocket LIVE VOICE Flow (Mic Input)")
    log("Info", CYAN, f"Will record {duration}s of audio then send to backend STT...")
    log("Info", YELLOW, "Make sure your microphone is working and speak clearly!")

    # Record audio (blocking)
    audio_bytes = record_microphone(duration)
    if not audio_bytes:
        return

    log("Audio", BLUE, f"Captured {len(audio_bytes)} bytes of PCM audio")

    # Chunk size: 4096 bytes per frame — simulates real streaming
    CHUNK = 4096

    try:
        async with websockets.connect(WS_URL) as ws:
            # ── Connected ack ──────────────────────────────────────
            raw = await ws.recv()
            msg = json.loads(raw) if isinstance(raw, str) else None
            if msg:
                log("↙ Connected", GREEN, f'{msg.get("message", "")}')

            # ── Stream binary audio in chunks ──────────────────────
            log("↗ Sending", BLUE, f"Streaming audio in {CHUNK}-byte chunks...")
            total_chunks = 0
            for i in range(0, len(audio_bytes), CHUNK):
                chunk = audio_bytes[i:i + CHUNK]
                await ws.send(chunk)   # Binary frame
                total_chunks += 1
            log("↗ Sent", GREEN, f"Streamed {total_chunks} audio chunks ({len(audio_bytes)} bytes total)")

            # Signal end of audio with PCM mimetype — tells backend to set encoding=linear16
            await ws.send(json.dumps({"type": "end_audio", "mimetype": "audio/pcm"}))
            log("↗ Sent", BLUE, "type=end_audio  mimetype=audio/pcm  → Backend STT will use linear16 encoding")

            tts_audio_chunks = []

            # ── Listen for all server events ───────────────────────
            while True:
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=40.0)
                except asyncio.TimeoutError:
                    log("⏱ Timeout", YELLOW, "No response in 40s. Done.")
                    break

                if isinstance(raw, bytes):
                    tts_audio_chunks.append(raw)
                    log("↙ Audio", MAGENTA, f"TTS audio chunk: {len(raw)} bytes")
                    continue

                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    continue

                t = msg.get("type")

                if t == "transcript":
                    log("↙ Transcript", CYAN + BOLD, f'"{msg["text"]}"')

                elif t == "action":
                    log("↙ Action", CYAN, f'action={msg["action"]}  param="{msg.get("param", "")}"')

                elif t == "llm_chunk":
                    print(f"{MAGENTA}{msg['text']}{RESET}", end="", flush=True)

                elif t == "tts_start":
                    print()
                    log("↙ TTS Start", YELLOW, "Generating voice response...")

                elif t == "tts_done":
                    total_kb = sum(len(c) for c in tts_audio_chunks) / 1024
                    log("↙ TTS Done", GREEN, f"Voice response: {total_kb:.1f} KB audio")
                    if tts_audio_chunks:
                        mp3_bytes = b"".join(tts_audio_chunks)
                        # Try inline playback first
                        samples, sr = mp3_bytes_to_numpy(mp3_bytes)
                        if samples is not None:
                            try:
                                import sounddevice as sd
                                log("🔊 Playing", MAGENTA + BOLD, f"Playing {len(samples)/sr:.1f}s of audio...")
                                sd.play(samples, samplerate=sr)
                                sd.wait()   # block until done
                                log("✅ Done", GREEN, "Playback complete")
                            except Exception as e:
                                log("⚠ Playback", YELLOW, f"sounddevice error: {e}")
                        else:
                            audio_file = os.path.join(tempfile.gettempdir(), "senorita_voice_response.mp3")
                            with open(audio_file, "wb") as f:
                                f.write(mp3_bytes)
                            log("   Saved →", YELLOW, f"{audio_file}  (pip install pydub + ffmpeg for live playback)")
                    break

                elif t == "error":
                    log("↙ Error", RED, f'{msg.get("message")}')
                    break

                elif t == "instruction":
                    log("↙ Instruction", CYAN, f'{msg.get("instruction")}')

                else:
                    log(f"↙ {t}", DIM, str(msg))

    except websockets.ConnectionRefusedError:
        log("❌ WS", RED, "Connection refused — is the backend running?")
    except Exception as e:
        log("❌ WS", RED, f"Error: {e}")


# ══════════════════════════════════════════════════════════════
#  PART 4 — CONTINUOUS CONVERSATION WITH BARGE-IN
# ══════════════════════════════════════════════════════════════

# ── Barge-in config ───────────────────────────────────────────
BARGE_IN_THRESHOLD = 0.03   # RMS level (0.0–1.0) that triggers barge-in
BARGE_IN_CHUNK     = 512    # Samples per RMS check (~32ms at 16kHz)


def mp3_bytes_to_numpy(mp3_bytes: bytes, target_sr: int = 24000):
    """
    Decode MP3 bytes → float32 mono numpy array using pydub.
    Falls back to None if pydub / ffmpeg not available.
    Returns (samples: np.ndarray, sample_rate: int) or (None, None).
    """
    try:
        from pydub import AudioSegment  # type: ignore
    except ImportError:
        return None, None
    try:
        seg = AudioSegment.from_mp3(io.BytesIO(mp3_bytes))
        seg = seg.set_frame_rate(target_sr).set_channels(1).set_sample_width(2)
        samples = np.frombuffer(seg.raw_data, dtype=np.int16).astype(np.float32) / 32768.0
        return samples, target_sr
    except Exception:
        return None, None


def play_with_barge_in(samples: np.ndarray, sr: int, barge_in_event: threading.Event) -> bool:
    """
    Plays audio samples via sounddevice while simultaneously monitoring the
    microphone for barge-in (user speaking).

    Returns True if barge-in was detected (caller should start new recording).
    Returns False if playback completed normally.

    How it works:
      - Playback runs on main thread via sd.play() (non-blocking)
      - A background thread captures mic frames and computes RMS
      - If RMS > BARGE_IN_THRESHOLD, sets barge_in_event and calls sd.stop()
      - Main thread polls both sd.get_status() and barge_in_event to detect end
    """
    try:
        import sounddevice as sd
    except ImportError:
        log("❌ Audio", RED, "sounddevice not installed — install it to enable playback")
        # Still simulate by sleeping for audio duration
        time.sleep(len(samples) / sr)
        return False

    barge_detected = threading.Event()

    def mic_monitor():
        """Background thread: monitors mic for barge-in during playback"""
        try:
            with sd.InputStream(
                samplerate=SAMPLE_RATE,
                channels=1,
                dtype="float32",
                blocksize=BARGE_IN_CHUNK,
            ) as mic:
                while not barge_in_event.is_set() and not barge_detected.is_set():
                    chunk, _ = mic.read(BARGE_IN_CHUNK)
                    rms = float(np.sqrt(np.mean(chunk ** 2)))
                    if rms > BARGE_IN_THRESHOLD:
                        barge_detected.set()
                        barge_in_event.set()   # signal caller
                        sd.stop()              # kill playback immediately
                        log("🛑 Barge-In!", RED + BOLD, f"Mic RMS={rms:.3f} > threshold={BARGE_IN_THRESHOLD} — stopping audio")
                        break
        except Exception:
            pass  # Monitor may fail if mic not available — just let playback finish

    monitor_thread = threading.Thread(target=mic_monitor, daemon=True)
    monitor_thread.start()

    # Start playback (non-blocking)
    sd.play(samples, samplerate=sr)

    # Wait until playback finishes OR barge-in fires
    while sd.get_stream().active and not barge_detected.is_set():
        time.sleep(0.05)

    barge_in_event.set()  # stop monitor thread if still running
    monitor_thread.join(timeout=1.0)
    return barge_detected.is_set()


async def ws_continuous_conversation(record_secs: int = 4):
    """
    Mode 4: Continuous multi-turn voice conversation with real barge-in.

    Pipeline per turn:
      1. 🎙 Record {record_secs}s of mic audio
      2. ↗ Send WAV bytes to backend  /ws/voice
      3. ↙ Receive: transcript → action → LLM stream → TTS audio chunks
      4. 🔊 Play TTS audio while monitoring mic for barge-in
      5. If barge-in: immediately start next turn (step 1)
         If normal end: wait 0.5s then start next turn
      6. Loop until Ctrl+C or user says 'stop senorita'

    Barge-in:
      A background thread continuously reads the mic during playback.
      If mic RMS exceeds BARGE_IN_THRESHOLD, sd.stop() is called and
      recording immediately starts for the next turn.
    """
    section("4/4  CONTINUOUS CONVERSATION  (Ctrl+C to stop)")
    log("Info", CYAN,   f"Recording {record_secs}s per turn | Barge-in threshold={BARGE_IN_THRESHOLD}")
    log("Info", YELLOW, "TTS playback needs pydub+ffmpeg for audio. Install: pip install pydub")
    log("Info", DIM,    "Say 'stop senorita' to end the conversation.")
    print()

    try:
        import sounddevice as sd
        playback_available = True
    except ImportError:
        playback_available = False
        log("⚠ Audio", YELLOW, "sounddevice not found — will show text only, no audio playback")

    turn = 0

    try:
        while True:
            turn += 1
            print(f"\n{CYAN}{BOLD}━━━ Turn {turn} {'━' * 40}{RESET}")

            # ── 1. Record ─────────────────────────────────────────────
            log(f"T{turn} 🎙 Record", YELLOW, f"Recording {record_secs}s — SPEAK NOW!")
            try:
                audio_np = sd.rec(
                    int(record_secs * SAMPLE_RATE),
                    samplerate=SAMPLE_RATE,
                    channels=CHANNELS,
                    dtype="int16",
                )
                for i in range(record_secs, 0, -1):
                    print(f"\r  {YELLOW}⏱ {i}s...{RESET}  ", end="", flush=True)
                    time.sleep(1)
                sd.wait()
                print(f"\r  {GREEN}✅ Captured{RESET}           ")
            except Exception as e:
                log(f"T{turn} ❌ Mic", RED, f"Recording failed: {e}")
                break

            # Convert numpy int16 → WAV bytes
            wav_buf = io.BytesIO()
            with wave.open(wav_buf, "wb") as wf:
                wf.setnchannels(1)
                wf.setsampwidth(2)          # int16
                wf.setframerate(SAMPLE_RATE)
                wf.writeframes(audio_np.tobytes())
            wav_bytes = wav_buf.getvalue()
            log(f"T{turn} Audio", BLUE, f"WAV: {len(wav_bytes)} bytes → sending to backend")

            # ── 2. WebSocket: Send audio + receive full pipeline ───────
            tts_chunks: list[bytes] = []
            transcript_text = ""
            interrupted = False

            try:
                async with websockets.connect(WS_URL) as ws:
                    # Wait for connected ack
                    raw = await ws.recv()
                    if isinstance(raw, str):
                        ack = json.loads(raw)
                        log(f"T{turn} ↙ WS", GREEN, f'connected: {ack.get("message", "")}')

                    # Stream WAV in chunks
                    CHUNK = 4096
                    for i in range(0, len(wav_bytes), CHUNK):
                        await ws.send(wav_bytes[i:i + CHUNK])

                    # Signal end with WAV mimetype (auto-detected, no encoding kwarg needed)
                    await ws.send(json.dumps({"type": "end_audio", "mimetype": "audio/wav"}))
                    log(f"T{turn} ↗ Sent", BLUE, "end_audio — waiting for STT…")

                    # Collect all events until tts_done or error
                    while True:
                        try:
                            raw = await asyncio.wait_for(ws.recv(), timeout=40.0)
                        except asyncio.TimeoutError:
                            log(f"T{turn} ⏱", YELLOW, "40s timeout waiting for response")
                            break

                        if isinstance(raw, bytes):
                            tts_chunks.append(raw)
                            continue

                        try:
                            msg = json.loads(raw)
                        except json.JSONDecodeError:
                            continue

                        t = msg.get("type")

                        if t == "transcript":
                            transcript_text = msg.get("text", "")
                            log(f"T{turn} ↙ STT", CYAN + BOLD, f'"{transcript_text}"')
                            # Stop-word detection
                            if any(w in transcript_text.lower() for w in ("stop senorita", "stop seniorita", "goodbye senorita")):
                                log(f"T{turn} 🛑 Stop", RED, "Stop word detected — ending conversation")
                                interrupted = True
                                break

                        elif t == "action":
                            log(f"T{turn} ↙ Action", CYAN, f'action={msg["action"]}  param="{msg.get("param", "")}"')

                        elif t == "llm_chunk":
                            print(f"{MAGENTA}{msg['text']}{RESET}", end="", flush=True)

                        elif t == "tts_start":
                            print()  # newline after LLM stream
                            log(f"T{turn} ↙ TTS", YELLOW, "Generating audio response…")

                        elif t == "tts_done":
                            total_kb = sum(len(c) for c in tts_chunks) / 1024
                            log(f"T{turn} ↙ TTS✓", GREEN, f"Audio ready: {total_kb:.1f} KB")
                            break

                        elif t == "error":
                            log(f"T{turn} ↙ Err", RED, msg.get("message", ""))
                            break

            except websockets.ConnectionRefusedError:
                log(f"T{turn} ❌", RED, "Connection refused — is the backend running?")
                break
            except Exception as e:
                log(f"T{turn} ❌", RED, f"WS error: {e}")
                break

            if interrupted:
                break

            # ── 3. Playback with barge-in ──────────────────────────────
            if tts_chunks and playback_available:
                mp3_bytes = b"".join(tts_chunks)
                samples, sr = mp3_bytes_to_numpy(mp3_bytes)

                if samples is not None:
                    log(f"T{turn} 🔊 Play", MAGENTA + BOLD, f"Playing {len(samples)/sr:.1f}s of audio (barge-in armed)…")
                    barge_in_event = threading.Event()
                    barged_in = play_with_barge_in(samples, sr, barge_in_event)
                    if barged_in:
                        log(f"T{turn} 🔁", RED + BOLD, "Barge-in! Starting next turn immediately…")
                        continue   # skip the 0.5s pause and go straight to recording
                    else:
                        log(f"T{turn} ✅ Done", GREEN, "Playback complete — starting next turn in 0.5s…")
                else:
                    log(f"T{turn} ⚠ pydub", YELLOW, "Could not decode MP3 (pydub/ffmpeg missing). Text-only mode.")
                    mp3_file = os.path.join(tempfile.gettempdir(), f"senorita_turn_{turn}.mp3")
                    with open(mp3_file, "wb") as f:
                        f.write(mp3_bytes)
                    log(f"T{turn} Saved", DIM, f"Audio at: {mp3_file}")
            elif tts_chunks:
                # No sounddevice: save and continue
                mp3_file = os.path.join(tempfile.gettempdir(), f"senorita_turn_{turn}.mp3")
                with open(mp3_file, "wb") as f:
                    for c in tts_chunks:
                        f.write(c)
                log(f"T{turn} Saved", DIM, f"Audio at: {mp3_file} (install sounddevice + pydub for live playback)")

            time.sleep(0.5)   # Brief pause before next turn

    except KeyboardInterrupt:
        print(f"\n{YELLOW}Conversation ended by user (Ctrl+C).{RESET}")

    log("Done", GREEN, f"Conversation ended after {turn} turn(s).")


# ══════════════════════════════════════════════════════════════
#  INTERACTIVE MENU
# ══════════════════════════════════════════════════════════════

async def main():
    print(f"""
{CYAN}{BOLD}╔══════════════════════════════════════════════════════════════╗
║          🌹 SENORITA VOICE AI — TEST & DEMO SCRIPT          ║
║          Backend: {BASE_URL:<43}║
╚══════════════════════════════════════════════════════════════╝{RESET}
""")

    while True:
        print(f"""
{BOLD}Select a test:{RESET}
  {GREEN}1{RESET} — HTTP REST endpoint suite (health, status, voices, TTS, command)
  {BLUE}2{RESET} — WebSocket text command (type a command, see full pipeline)
  {YELLOW}3{RESET} — WebSocket VOICE command (record mic → STT → LLM → TTS)
  {MAGENTA}4{RESET} — {BOLD}CONTINUOUS CONVERSATION{RESET} 🔄  (live multi-turn + barge-in)
  {RED}q{RESET} — Quit
""")
        choice = input(f"{BOLD}> {RESET}").strip().lower()

        if choice == "1":
            await test_http_endpoints()

        elif choice == "2":
            print(f"\n{BOLD}Enter your voice command (as text):{RESET}")
            print(f"  {DIM}Examples: 'explain what async await does in Python'{RESET}")
            print(f"  {DIM}          'debug this: def add(a,b): return a-b'{RESET}")
            print(f"  {DIM}          'create file utils.py'{RESET}")
            cmd = input(f"{BOLD}Command > {RESET}").strip()
            if cmd:
                await ws_text_command(cmd)

        elif choice == "3":
            print(f"\n{BOLD}How many seconds to record? {DIM}(default: 5){RESET}")
            secs_input = input(f"{BOLD}Seconds > {RESET}").strip()
            try:
                secs = int(secs_input) if secs_input else RECORD_SECS
                secs = max(2, min(secs, 30))  # clamp to 2–30s
            except ValueError:
                secs = RECORD_SECS
            await ws_voice_command(secs)

        elif choice == "4":
            print(f"\n{BOLD}Seconds per recording turn? {DIM}(default: 4, recommended 3-5){RESET}")
            secs_input = input(f"{BOLD}Seconds > {RESET}").strip()
            try:
                secs = int(secs_input) if secs_input else 4
                secs = max(2, min(secs, 15))
            except ValueError:
                secs = 4
            print(f"""
{MAGENTA}{BOLD}  ┌─────────────────────────────────────────────────────────┐
  │  CONTINUOUS CONVERSATION MODE                           │
  │  • Speak when you see 🎙  SPEAK NOW!                   │
  │  • Senorita will respond with voice                     │
  │  • Speak over her to interrupt (barge-in)               │
  │  • Say 'stop senorita' to end the conversation          │
  │  • Press Ctrl+C anytime to exit                         │
  └─────────────────────────────────────────────────────────┘{RESET}
""")
            await ws_continuous_conversation(record_secs=secs)

        elif choice in ("q", "quit", "exit"):
            print(f"\n{GREEN}Goodbye! 🌹{RESET}\n")
            break

        else:
            print(f"{RED}Unknown choice. Enter 1, 2, 3, 4 or q.{RESET}")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print(f"\n{YELLOW}Interrupted. Goodbye!{RESET}\n")
