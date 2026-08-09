from datetime import datetime
from typing import Optional

from beanie import Document
from pydantic import Field
import uuid

from src.api.schemas.user import User
from src.core.security import get_password_hash

def generate_user_number() -> str:
    return str(uuid.uuid4()).split('-')[0].upper()


async def create_user(
        username: str, 
        password: str, 
        email: Optional[str] = None,
    ) -> Document:
        
    user_number = generate_user_number()
    user = User(
        user_number=user_number,
        username=username,
        email=email,
        hashed_password=get_password_hash(password)
    )
    await user.insert()
    return user

async def get_user_by_username(username: str) -> Optional[Document]:
    user = await User.find_one(User.username == username)
    return user

async def delete_user(user_id: str) -> None:
    user = await User.get(user_id)
    if user:
        await user.delete()