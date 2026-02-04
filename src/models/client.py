from datetime import datetime
from zoneinfo import ZoneInfo

from beanie import Document

class Client(Document):
    client_number: int      # 고객 번호
    name: str               # 고객 이름
    status: str = "Active"  # Active, Pending, Inactive
    created_at: datetime = datetime.now(tz=ZoneInfo("Asia/Seoul"))

    class Settings:
        name = "clients"