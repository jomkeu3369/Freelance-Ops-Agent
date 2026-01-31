import os
from datetime import datetime, timedelta

from fastapi import APIRouter, HTTPException, Depends, Response, Request
from fastapi.security import OAuth2PasswordRequestForm, OAuth2PasswordBearer

from starlette import status
from jose import JWTError, jwt

from src.core.security import (
    create_access_token, 
    create_refresh_token, 
    verify_password, 
    verify_refresh_token,
    verify_access_token
)
from src.models.user import User
from src.api.auth.auth_schema import Token, TokenResponse
from src.logs.log import get_logger

router = APIRouter(prefix="/auth", tags=["auth"])
logger = get_logger()

# 환경 변수
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", 30))
REFRESH_TOKEN_EXPIRE_DAYS = int(os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", 7))
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")

async def get_current_user(request: Request):
    auth_header = request.headers.get("Authorization")
    token = None
    
    if auth_header and auth_header.startswith("Bearer "):
        token = auth_header.split(" ")[1]
    else:
        token = request.cookies.get("access_token")

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="인증 토큰이 없습니다.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    try:
        payload = verify_access_token(token)
        if payload is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="토큰이 만료되었거나 유효하지 않습니다.")
        
        username: str = payload.get("sub")
        user = await User.find_one(User.username == username) #
        if user is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="사용자를 찾을 수 없습니다.")
        return user
    
    except Exception:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="인증에 실패했습니다.")
    
# 로그인
@router.post("/login", response_model=Token)
async def auth_login_for_access_token(response: Response, form_data: OAuth2PasswordRequestForm = Depends()):
    """OAuth2 호환 로그인 엔드포인트"""
    
    user = await User.find_one(User.username == form_data.username)
    
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="아이디 또는 비밀번호가 일치하지 않습니다.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # 토큰 생성
    access_token = create_access_token(data={"sub": user.username})
    refresh_token = create_refresh_token(data={"sub": user.username})
    
    # Access token을 HttpOnly 쿠키에 저장
    response.set_cookie(
        key="access_token",
        value=access_token,
        httponly=True,
        secure=True,
        samesite="Lax",
        max_age=ACCESS_TOKEN_EXPIRE_MINUTES * 60
    )

    # Refresh token을 HttpOnly 쿠키에 저장
    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        httponly=True,
        secure=True,
        samesite="Lax",
        max_age=REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60
    )
    
    return Token(
        access_token=access_token,
        token_type="bearer",
        user_id=str(user.id)
    )


# 리프레시 토큰 갱신
@router.post("/refresh", response_model=TokenResponse)
async def auth_refresh_access_token(request: Request):
    """쿠키에서 refresh token을 읽어 새로운 access token 발급"""
    
    refresh_token = request.cookies.get("refresh_token")
    
    if not refresh_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="리프레시 토큰이 없습니다."
        )
    
    # Refresh token 검증
    payload = verify_refresh_token(refresh_token)
    
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="유효하지 않은 리프레시 토큰입니다."
        )
    
    username = payload.get("sub")
    new_access_token = create_access_token(data={"sub": username})
    
    return TokenResponse(
            access_token=new_access_token,
            token_type="bearer"
        )


# 로그아웃
@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def auth_logout(response: Response):
    """Refresh token 쿠키 삭제"""
    
    response.delete_cookie("access_token")
    response.delete_cookie("refresh_token")


# 내 정보 조회
@router.get("/me", response_model=User)
async def auth_me(current_user: User = Depends(get_current_user)):
    return current_user