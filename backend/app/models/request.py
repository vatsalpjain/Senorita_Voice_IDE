from pydantic import BaseModel

class TextCommandRequest(BaseModel):
    transcript: str
    context: str | None = None

class TTSRequest(BaseModel):
    text: str
    voice: str = "aura-2-asteria-en"   # SDK v5 voice name
