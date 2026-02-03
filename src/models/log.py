from datetime import datetime
from zoneinfo import ZoneInfo
from typing import Optional

from beanie import Document
from pymongo import IndexModel, ASCENDING

class SystemLog(Document):
    level: str
    logger: str
    message: str
    service: str = "app"
    file_info: Optional[str] = None
    time: datetime = datetime.now(tz=ZoneInfo("Asia/Seoul"))

    class Settings:
        name = "system_logs"
        indexes = [
            IndexModel([("time", ASCENDING)], expireAfterSeconds=604800),
            IndexModel([("level", ASCENDING)]),
            IndexModel([("service", ASCENDING)])
        ]