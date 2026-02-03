from fastapi import APIRouter, Depends, HTTPException, status

from src.api.auth.auth_router import get_current_user
from src.api.dashboard.dashboard_schema import DashboardData, ServerResources
from src.api.dashboard.vultr_service import get_vultr_data
from src.core.monitor import get_server_resources
from src.logs.log import get_logger

router = APIRouter(prefix="/dashboard", tags=["dashboard"])
logger = get_logger()


@router.get("/system", response_model=DashboardData)
async def get_dashboard_stats(current_user = Depends(get_current_user)):
    try:
        vultr_data = await get_vultr_data()
        local_resources = get_server_resources()

        if not vultr_data:
            vultr_data = {
                "balance": 0.0,
                "pending_charges": 0.0,
                "instance_count": 0,
                "instances": []
            }

        return {
            **vultr_data,
            "server_resources": local_resources
        }

    except Exception as e:
        logger.error(f"시스템 데이터 조회 실패: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="시스템 모니터링 데이터를 불러오는 중 오류가 발생했습니다."
        )