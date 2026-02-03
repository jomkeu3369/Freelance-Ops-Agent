from fastapi import APIRouter, Depends, HTTPException, status

from src.api.auth.auth_router import get_current_user
from src.api.dashboard.dashboard_schema import DashboardData
from src.api.dashboard.vultr_service import get_vultr_data
from src.logs.log import get_logger

router = APIRouter(prefix="/dashboard", tags=["dashboard"])
logger = get_logger()


@router.get("/stats", response_model=DashboardData)
async def get_dashboard_stats(current_user = Depends(get_current_user)):
    try:
        data = await get_vultr_data()
        
        if not data:
            return {
                "balance": 0.0, 
                "pending_charges": 0.0, 
                "instance_count": 0,
                "instances": []
            }
            
        return data

    except Exception as e:
        logger.error(f"대시보드 데이터 조회 실패: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="외부 클라우드 서비스 연동 중 오류가 발생했습니다."
        )