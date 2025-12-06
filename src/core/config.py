from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    PROJECT_NAME: str = "Freelance-Ops-Agent"
    OPENAI_API_KEY: str
    TAVILY_API_KEY: str | None = None
    
    class Config:
        env_file = ".env"

settings = Settings()