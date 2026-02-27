from pydantic import BaseModel
from typing import List

class TextCommandRequest(BaseModel):
    transcript: str
    context: str | None = None

class TTSRequest(BaseModel):
    text: str
    voice: str = "aura-2-asteria-en"   # SDK v5 voice name

class ChatMessageItem(BaseModel):
    role: str        # "user" | "assistant" | "error"
    text: str
    intent: str | None = None

class CodeChangeItem(BaseModel):
    heading: str
    description: str
    action: str
    filename: str
    code: str | None = None

class SummarizeRequest(BaseModel):
    messages: List[ChatMessageItem]
    code_changes: List[CodeChangeItem] = []
    filename: str | None = None    # active file context
