
from pydantic import BaseModel, EmailStr, field_validator
from enum import Enum
from typing import Optional, Union

class Token(BaseModel):
    access_token: str
    token_type: str
    user_id: str
