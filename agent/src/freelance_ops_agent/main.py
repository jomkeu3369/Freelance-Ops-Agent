from fastapi import FastAPI

from freelance_ops_agent import __version__
from freelance_ops_agent.config import get_settings
from freelance_ops_agent.contracts import HealthResponse


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="Freelance Ops Agent Internal API",
        version=__version__,
        docs_url="/internal/docs",
        openapi_url="/internal/openapi.json"
    )

    @app.get("/health", response_model=HealthResponse, tags=["Health"])
    async def health() -> HealthResponse:
        return HealthResponse(status="UP", service=settings.service_name, version=settings.service_version)

    return app


app = create_app()

