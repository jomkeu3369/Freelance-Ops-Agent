from datetime import datetime
from typing import Optional

from beanie import Document
from pydantic import Field

class User(Document):
    username: str = Field(..., unique=True)
    email: Optional[str] = None
    hashed_password: str
    full_name: Optional[str] = None
    is_active: bool = True
    created_at: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        name = "users"