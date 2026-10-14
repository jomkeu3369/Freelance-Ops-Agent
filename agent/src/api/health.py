"""서비스 버전과 생존·준비 상태 조회."""

from fastapi import APIRouter, Request, Response

from config import get_settings
from contracts import HealthResponse
from infrastructure import PostgresCheckpointJournal
from infrastructure.database import PgVectorConnectionManager

router = APIRouter()


@router.get("/version", tags=["root"])
async def get_version() -> dict[str, str]:
    return {"version": get_settings().service_version}


@router.get("/health", response_model=HealthResponse)
async def health_check() -> HealthResponse:
    settings = get_settings()
    return HealthResponse(status="UP", service=settings.service_name, version=settings.service_version)


@router.get("/health/readiness", response_model=HealthResponse, responses={503: {"model": HealthResponse}})
async def readiness_check(request: Request, response: Response) -> HealthResponse:
    settings = get_settings()
    state = request.app.state
    ready = state.runtime_ready
    database: PgVectorConnectionManager | None = state.database_manager
    checkpoint: PostgresCheckpointJournal | None = state.checkpoint_journal
    if ready and checkpoint is not None and not checkpoint.is_open:
        ready = False
    if ready and database is not None:
        ready = await state.database_readiness_probe.check(database)
    response.status_code = 200 if ready else 503
    return HealthResponse(
        status="UP" if ready else "DOWN", service=settings.service_name, version=settings.service_version
    )
