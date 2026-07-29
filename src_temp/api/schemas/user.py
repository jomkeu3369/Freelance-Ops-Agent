from datetime import datetime
from zoneinfo import ZoneInfo
from typing import Optional

from beanie import Document
from pydantic import Field

def get_kst_now():
    return datetime.now(tz=ZoneInfo("Asia/Seoul"))

class User(Document):
    user_number: str = Field(..., unique=True, description="사용자 고유 번호")
    username: str = Field(..., min_length=3, max_length=50, description="사용자 이름")
    
    email: Optional[str] = Field(default=None, unique=True, description="이메일 주소")
    hashed_password: str = Field(..., min_length=6, max_length=100, description="해시된 비밀번호")

    failed_login_attempts: int = Field(default=0, description="연속된 로그인 실패 횟수")
    locked_until: Optional[datetime] = Field(default=None, description="계정 잠금 해제 예정 시간")

    is_active: bool = Field(default=True, description="활성 상태")
    created_at: datetime = Field(default_factory=get_kst_now, description="사용자 생성 시간")

    class Settings:
        name = "users"