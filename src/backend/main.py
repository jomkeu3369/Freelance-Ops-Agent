from fastapi import FastAPI
from src.backend.api.v1.endpoints import analysis
from src.core.config import settings

app = FastAPI(title=settings.PROJECT_NAME)
app.include_router(analysis.router, prefix="/api/v1", tags=["Analysis"])

@app.get("/health")
def health_check():
    return {"status": "ok"}