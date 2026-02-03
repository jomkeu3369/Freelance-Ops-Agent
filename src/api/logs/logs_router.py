import os
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Path

from src.api.logs.logs_schema import LogResponse, LogListResponse
from src.api.logs.logs_crud import get_filtered_logs, delete_log_by_id
from src.logs.log import get_logger


router = APIRouter(prefix="/auth", tags=["logs"])
logger = get_logger()

@router.get("/logs", response_model=LogListResponse)
async def get_logs(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    level: Optional[str] = None,
    service: Optional[str] = None,
    search: Optional[str] = None
):
    
    total_count, logs = await get_filtered_logs(page, limit, level, service, search)

    return {
        "total": total_count,
        "page": page,
        "limit": limit,
        "logs": [
            LogResponse(
                id=str(log.id),
                **log.dict(exclude={"id"})
            ) for log in logs
        ]
    }

@router.delete("/logs/{log_id}")
async def delete_log(log_id: str = Path(...)):
    is_deleted = await delete_log_by_id(log_id)
    
    if not is_deleted:
        raise HTTPException(status_code=404, detail="Log not found")
    
    return {"status": "deleted", "id": log_id}