from pydantic import BaseModel

class ActionResponse(BaseModel):
    action: str
    param: str
    instruction: dict | None = None

class SenoResponse(BaseModel):
    transcript: str
    action: str
    llm_response: str | None = None
    instruction: dict | None = None
    audio_url: str | None = None
    error: str | None = None
