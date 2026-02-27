# SpellCode Voice AI - Python Backend

Complete Voice AI system with Speech-to-Text (STT), Text-to-Speech (TTS), interruption handling, and state management.

## Features

✅ **Real-time Speech-to-Text** - Deepgram WebSocket streaming with interim results
✅ **Text-to-Speech with Queue** - Priority-based speech queue management

✅ **Smart Interruption** - Interrupt TTS when user starts speaking

✅ **State Management** - Comprehensive state tracking and history

✅ **Event-Driven Architecture** - Async callbacks for all events

✅ **Auto-Restart Listening** - Seamless conversation flow

✅ **Error Handling** - Robust error recovery and logging

✅ **Session Statistics** - Track transcriptions, speeches, and duration

## Architecture

```
┌─────────────────────────────────────────────┐
│         Voice Controller (Main)             │
├─────────────────────────────────────────────┤
│  - Orchestrates all services                │
│  - Manages conversation flow                │
│  - Handles interruptions                    │
└──────────┬─────────────┬────────────────────┘
           │             │
    ┌──────▼─────┐  ┌───▼────────┐
    │ STT Service│  │ TTS Service│
    ├────────────┤  ├────────────┤
    │ - Deepgram │  │ - Deepgram │
    │ - WebSocket│  │ - Queue    │
    │ - Streaming│  │ - Priority │
    └──────┬─────┘  └───┬────────┘
           │             │
           └──────┬──────┘
                  │
         ┌────────▼────────┐
         │  State Manager  │
         ├─────────────────┤
         │ - State tracking│
         │ - History       │
         │ - Statistics    │
         └─────────────────┘
```

## Installation

### Requirements

* Python 3.9+
* Deepgram API Key

### Setup

```bash
# Clone repository
git clone https://github.com/your-repo/spellcode-voice-ai-python.git
cd spellcode-voice-ai-python

# Create virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Set API key
export DEEPGRAM_API_KEY="your_api_key_here"
```

## Quick Start

```python
import asyncio
import os
from src.services.voice_controller import VoiceController
from src.models.types import VoiceConfig

async def main():
    # Configure
    config = VoiceConfig(
        deepgram_api_key=os.getenv("DEEPGRAM_API_KEY"),
        stt_model="nova-2",
        tts_model="aura-asteria-en",
        language="en-US",
        interruption_enabled=True,
    )
  
    # Create controller
    controller = VoiceController(config)
  
    # Setup event handlers
    controller.on_transcription_final = lambda result: print(f"Heard: {result.text}")
    controller.on_speech_complete = lambda id: print(f"Spoke: {id}")
  
    # Initialize
    await controller.initialize()
  
    # Start listening
    await controller.start_listening()
    # ... send audio data ...
    await controller.stop_listening()
  
    # Speak response
    await controller.speak("Hello! I understood you.")
  
    # Cleanup
    await controller.shutdown()

asyncio.run(main())
```

## Complete API Documentation

### VoiceController

Main controller orchestrating STT, TTS, and state management.

#### Methods

```python
# Initialization
await controller.initialize()                    # Initialize system
await controller.shutdown()                      # Shutdown system

# Listening
await controller.start_listening()               # Start STT
await controller.stop_listening()                # Stop STT
await controller.send_audio(audio_bytes)         # Send audio data

# Speaking
speech_id = await controller.speak(text, priority=0)  # Queue speech
await controller.interrupt_speech()              # Interrupt current speech
await controller.clear_speech_queue()            # Clear queue

# Configuration
controller.set_interrupt_on_speech(True)         # Auto-interrupt on user speech
controller.set_auto_restart_listening(True)      # Auto-restart after speech

# Status
state = controller.get_state()                   # Get current state
status = controller.get_status()                 # Get full status
stats = controller.get_session_stats()           # Get session statistics
```

#### Event Handlers

```python
# Transcription events
controller.on_transcription_final = async_callback      # Final transcription
controller.on_transcription_interim = async_callback    # Interim transcription
controller.on_transcription = async_callback            # All transcriptions

# Speech events
controller.on_speech_complete = async_callback          # Speech completed

# User events
controller.on_user_speech_started = async_callback      # User started speaking
controller.on_user_speech_ended = async_callback        # User stopped speaking

# State events
controller.on_state_change = async_callback             # State changed
controller.on_error = async_callback                    # Error occurred
```

### STTService

Speech-to-Text service using Deepgram streaming API.

```python
# Create service
stt = STTService(api_key, config)

# Connection
await stt.connect()                              # Connect to Deepgram
await stt.disconnect()                           # Disconnect

# Listening
await stt.start_listening()                      # Mark as listening
await stt.stop_listening()                       # Stop and finalize
await stt.send_audio(audio_bytes)                # Send audio data

# Event handlers
stt.on_transcription_final = async_callback      # Final transcription
stt.on_transcription_interim = async_callback    # Interim transcription
stt.on_speech_started = async_callback           # Speech started
stt.on_utterance_end = async_callback            # Utterance ended
stt.on_error = async_callback                    # Error

# Status
status = stt.get_status()                        # Get connection status
```

### TTSService

Text-to-Speech service with queue management and interruption.

```python
# Create service
tts = TTSService(api_key, config)

# Speaking
speech_id = await tts.speak(text, priority=0)    # Queue speech
await tts.interrupt()                            # Interrupt current
await tts.clear_queue()                          # Clear queue
await tts.cancel_speech(speech_id)               # Cancel specific speech

# Configuration
tts.set_interruption_enabled(True)               # Enable interruption
tts.set_max_queue_size(10)                       # Set max queue size

# Event handlers
tts.on_speech_queued = async_callback            # Speech queued
tts.on_speech_start = async_callback             # Speech started
tts.on_speech_complete = async_callback          # Speech completed
tts.on_speech_cancelled = async_callback         # Speech cancelled
tts.on_speech_error = async_callback             # Speech error
tts.on_speech_ready = async_callback             # Audio ready for playback

# Status
status = tts.get_status()                        # Get service status
queue_status = tts.get_queue_status()            # Get queue status
```

### VoiceStateManager

Manages voice system state.

```python
# Create manager
state_manager = VoiceStateManager()

# State control
await state_manager.set_state(VoiceState.LISTENING)
await state_manager.set_listening(True)
await state_manager.set_speaking(True)
await state_manager.set_processing(True)
await state_manager.set_error(error)
await state_manager.clear_error()

# Recording
await state_manager.record_transcription(result)
await state_manager.record_speech(result)
state_manager.update_queue_size(size)

# Session
await state_manager.start_session()
stats = await state_manager.end_session()
stats = state_manager.get_session_stats()

# Queries
state = state_manager.get_state()
current = state_manager.get_current_state()
history = state_manager.get_state_history(limit=10)
is_idle = state_manager.is_idle()
can_listen = state_manager.can_start_listening()
can_speak = state_manager.can_speak()
summary = state_manager.get_summary()
```

## Configuration

### VoiceConfig

```python
config = VoiceConfig(
    deepgram_api_key="your_key",
    stt_model="nova-2",              # STT model
    tts_model="aura-asteria-en",     # TTS model
    language="en-US",                # Language
    interim_results=True,            # Enable interim results
    punctuate=True,                  # Auto punctuation
    smart_format=True,               # Smart formatting
    voice_id="asteria",              # TTS voice
    enable_vad=True,                 # Voice activity detection
    endpointing_ms=300,              # Silence for endpoint (ms)
    interruption_enabled=True,       # Allow interruption
    max_queue_size=10,               # Max speech queue size
    sample_rate=16000,               # Audio sample rate
    channels=1,                      # Audio channels
    encoding="linear16",             # Audio encoding
)
```

## State Machine

```
IDLE ←→ LISTENING ←→ PROCESSING
 ↕                       ↕
ERROR               SPEAKING
```

## Examples

### 1. Simple STT

```python
await controller.start_listening()
# ... capture audio from microphone ...
for chunk in audio_stream:
    await controller.send_audio(chunk)
await controller.stop_listening()
```

### 2. Simple TTS

```python
await controller.speak("Hello, world!")
```

### 3. Interruption

```python
# Start long speech
await controller.speak("This is a very long speech...")

# Interrupt after 1 second
await asyncio.sleep(1.0)
await controller.interrupt_speech()

# Speak something else
await controller.speak("Interrupted!")
```

### 4. Conversation Loop

```python
while True:
    # Listen
    await controller.start_listening()
    # ... wait for transcription ...
  
    # Process intent (your logic)
    response = process_intent(transcription)
  
    # Respond
    await controller.speak(response)
```

## Testing

```bash
# Run tests
pytest tests/

# Run with coverage
pytest --cov=src tests/

# Run example
python example_usage.py
```

## Logging

Uses `loguru` for comprehensive logging:

```python
from loguru import logger

# Configure
logger.add("voice_ai.log", rotation="10 MB", level="INFO")

# Logs are automatically generated by all services
```

## Error Handling

All async methods may raise exceptions. Always use try-except:

```python
try:
    await controller.initialize()
except Exception as e:
    logger.error(f"Failed to initialize: {e}")
```

## Performance Tips

1. **Audio Chunk Size** : Send 100-200ms chunks for best latency
2. **Sample Rate** : 16000 Hz recommended for STT
3. **Queue Size** : Keep TTS queue small (< 5) for responsiveness
4. **Endpointing** : Adjust `endpointing_ms` based on use case

## Troubleshooting

**Connection Issues**

* Check API key is valid
* Verify internet connection
* Check Deepgram API status

**Audio Issues**

* Verify sample rate matches config
* Check audio format (linear16)
* Ensure audio is not corrupted

**State Issues**

* Check `get_state()` for current state
* Review `get_status()` for detailed info
* Enable DEBUG logging
