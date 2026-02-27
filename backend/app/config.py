from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    # Groq settings
    GROQ_API_KEY: str
    GROQ_MODEL: str = "llama-3.3-70b-versatile"   # HARDCODED — do not change

    # Deepgram settings (SDK v5)
    DEEPGRAM_API_KEY: str
    DEEPGRAM_STT_MODEL: str = "nova-3"              # nova-3 is current model
    DEEPGRAM_TTS_VOICE: str = "aura-2-asteria-en"  # SDK v5 voice name

    # n8n webhook settings
    N8N_EMAIL_WEBHOOK_URL: str = ""
    N8N_GITHUB_WEBHOOK_URL: str = ""
    N8N_SLACK_WEBHOOK_URL: str = ""

    # App settings
    APP_ENV: str = "development"
    ALLOWED_ORIGINS: list[str] = ["http://localhost:3000", "http://localhost:5173"]
    LOG_LEVEL: str = "INFO"

    # Load environment variables from .env file
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

settings = Settings()
