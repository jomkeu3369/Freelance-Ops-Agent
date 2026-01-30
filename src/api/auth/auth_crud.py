from datetime import datetime
from typing import Optional

from beanie import Document
from pydantic import Field

from src.models.user import User
from src.core.security import get_password_hash

async def create_user(username: str, email: Optional[str], password: str, full_name: Optional[str] = None) -> Document:
    user = User(
        username=username,
        email=email,
        hashed_password=get_password_hash(password),
        full_name=full_name,
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