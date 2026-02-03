
from pydantic import BaseModel, EmailStr, field_validator
from typing import Generic, TypeVar, Optional
from enum import Enum

from datetime import datetime

class LogResponse(BaseModel):
    id: str
    level: str
    logger: str
    message: str
    service: str
    file_info: Optional[str] = None
    time: datetime

    class Confing:
        from_attributes = True


class LogListResponse(BaseModel):
    total: int
    page: int
    limit: int
    logs: list[LogResponse]