from typing import Optional, List, Tuple
from src.models.log import SystemLog

async def get_filtered_logs(
    page: int,
    limit: int,
    level: Optional[str] = None,
    service: Optional[str] = None,
    search: Optional[str] = None
) -> Tuple[int, List[SystemLog]]:
    
    query = SystemLog.find_all()

    if level:
        query = query.find(SystemLog.level == level)
    if service:
        query = query.find(SystemLog.service == service)
    if search:
        query = query.find(
            {"$or": [
                {"message": {"$regex": search, "$options": "i"}},
                {"logger": {"$regex": search, "$options": "i"}}
            ]}
        )

    total_count = await query.count()
    logs = await query.sort("-time").skip((page - 1) * limit).limit(limit).to_list()

    return total_count, logs

async def get_log_by_id(log_id: str) -> Optional[SystemLog]:
    return await SystemLog.get(log_id)

async def delete_log_by_id(log_id: str) -> bool:
    log = await SystemLog.get(log_id)
    if not log:
        return False
    
    await log.delete()
    return True