from datetime import datetime
from zoneinfo import ZoneInfo
from typing import Optional

from beanie import Document
from pymongo import IndexModel, ASCENDING
from pydantic import Field

def get_kst_now():
    return datetime.now(tz=ZoneInfo("Asia/Seoul"))

class SystemLog(Document):
    level: str = Field(..., description="로그 레벨 (e.g., INFO, ERROR)")
    logger: str = Field(..., description="로그를 생성한 로거 이름")
    message: str = Field(..., description="로그 메시지")
    service: str = Field(default="app", description="로그를 생성한 서비스 이름")
    file_info: Optional[str] = Field(None, description="파일 정보")
    time: datetime = Field(default_factory=get_kst_now, description="로그 생성 시간")

    class Settings:
        name = "system_logs"
        indexes = [
            IndexModel([("time", ASCENDING)], expireAfterSeconds=604800),
            IndexModel([("level", ASCENDING)]),
            IndexModel([("service", ASCENDING)])
        ]