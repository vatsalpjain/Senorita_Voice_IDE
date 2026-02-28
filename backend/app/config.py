from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    # Groq settings
    GROQ_API_KEY: str
    GROQ_MODEL: str = "llama-3.3-70b-versatile"   # HARDCODED — do not change

    # Deepgram settings (SDK v5)
    DEEPGRAM_API_KEY: str
    DEEPGRAM_STT_MODEL: str = "nova-3"              # nova-3 is current model
    DEEPGRAM_TTS_VOICE: str = "aura-2-asteria-en"  # SDK v5 voice name

    # n8n webhook settings — outbound (FastAPI → n8n)
    N8N_BASE_URL: str = "http://localhost:5678"  # n8n instance URL
    N8N_EMAIL_WEBHOOK_URL: str = ""  # n8n webhook for email workflow trigger
    
    # n8n webhook settings — inbound (n8n → FastAPI) security
    N8N_WEBHOOK_SECRET: str = ""  # shared secret for validating n8n callbacks
    N8N_ALLOWED_IPS: list[str] = ["127.0.0.1", "localhost"]  # IPs allowed to call n8n endpoints

    # App settings
    APP_ENV: str = "development"
    ALLOWED_ORIGINS: list[str] = [
        "http://localhost:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:3001",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]
    LOG_LEVEL: str = "INFO"

    # Load environment variables from .env file
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

settings = Settings()
