from datetime import datetime
from zoneinfo import ZoneInfo

from typing import Literal, Optional

from beanie import Document
from pydantic import Field

def get_kst_now():
    return datetime.now(tz=ZoneInfo("Asia/Seoul"))

class Client(Document):
    client_number: int = Field(..., unique=True, description="클라이언트 고유 번호")
    
    name: str = Field(..., description="클라이언트 이름")
    status: Literal["Active", "Pending", "Inactive"] = Field(default="Active", description="클라이언트 상태")

    created_at: datetime = Field(default_factory=get_kst_now, description="클라이언트 생성 시간")

    class Settings:
        name = "clients"