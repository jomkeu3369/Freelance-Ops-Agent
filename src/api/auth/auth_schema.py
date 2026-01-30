
from pydantic import BaseModel, EmailStr, field_validator
from typing import Generic, TypeVar, Optional
from enum import Enum

T = TypeVar('T')

class Token(BaseModel):
    access_token: str
    token_type: str
    user_id: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str


class ApiResponse(BaseModel, Generic[T]):
    success: bool
    data: Optional[T] = None
    message: Optional[str] = None