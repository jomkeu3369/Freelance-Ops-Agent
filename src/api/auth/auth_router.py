import os

from datetime import datetime, timedelta

from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import RedirectResponse, JSONResponse
from fastapi.security import OAuth2PasswordRequestForm, OAuth2PasswordBearer, OAuth2AuthorizationCodeBearer

from starlette import status
from starlette.requests import Request
from starlette.responses import RedirectResponse

from src.core.security import create_access_token, verify_password
from src.models.user import User
from src.api.auth.auth_schema import Token

router = APIRouter(prefix="/auth", tags=["auth"])

ACCESS_TOKEN_EXPIRE_MINUTES = os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES")
SECRET_KEY = os.getenv("SECRET_KEY")
ALGORITHM = os.getenv("ALGORITHM")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/stack/api/v1/login/email")


# auth 로그인 
@router.post("/login")
async def auth_login_for_access_token(form_data: OAuth2PasswordRequestForm = Depends()):
    """
    OAuth2 호환 로그인 엔드포인트
    - username: 사용자 ID (또는 이메일)
    - password: 비밀번호
    """

    user = await User.find_one(User.username == form_data.username)

    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="아이디 또는 비밀번호가 일치하지 않습니다.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    access_token = create_access_token(data={"sub": user.username})
    
    return Token(
        access_token=access_token,
        token_type="bearer",
        user_id=str(user.id)
    )

# async def get_current_user(token = Depends(oauth2_scheme)):
#     credentials_exception = HTTPException(
#         status_code=status.HTTP_401_UNAUTHORIZED,
#         detail="access token의 정보가 잘못되었습니다.",
#         headers={   "WWW-Authenticate": "Bearer"},
#     )

#     try:
#         payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])

#         user_id: str = payload.get("sub")
        
#         if user_id is None:
#             raise credentials_exception
#         else:
#             user = await user_crud.get_user_by_userid(db, user_id=int(user_id))
#             if user is None:
#                 raise credentials_exception
#             return user

#     except JWTError:
#         raise credentials_exception
