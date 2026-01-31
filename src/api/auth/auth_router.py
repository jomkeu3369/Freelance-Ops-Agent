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
    verify_refresh_token
)
from src.models.user import User
from src.api.auth.auth_schema import Token, TokenResponse, ApiResponse

router = APIRouter(prefix="/auth", tags=["auth"])

# 환경 변수
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", 30))
REFRESH_TOKEN_EXPIRE_DAYS = int(os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", 7))
SECRET_KEY = os.getenv("SECRET_KEY")
ALGORITHM = os.getenv("ALGORITHM", "HS256")

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/stack/api/v1/auth/login")

async def get_current_user(token: str = Depends(oauth2_scheme)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="access token의 정보가 잘못되었습니다.",
        headers={"WWW-Authenticate": "Bearer"},
    )
    
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        
        if username is None:
            raise credentials_exception
        
        user = await User.find_one(User.username == username)
        
        if user is None:
            raise credentials_exception
        
        return user
    
    except JWTError:
        raise credentials_exception
    
# 로그인
@router.post("/login", response_model=ApiResponse[Token])
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
    
    # Refresh token을 HttpOnly 쿠키에 저장
    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        httponly=True,
        secure=True,
        samesite="Lax",
        max_age=REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60
    )
    
    return ApiResponse(
        success=True,
        data=Token(
            access_token=access_token,
            token_type="bearer",
            user_id=str(user.id)
        ),
        message="로그인 성공"
    )


# 리프레시 토큰 갱신
@router.post("/refresh", response_model=ApiResponse[TokenResponse])
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
    
    return ApiResponse(
        success=True,
        data=TokenResponse(
            access_token=new_access_token,
            token_type="bearer"
        ),
        message="토큰 갱신 성공"
    )


# 로그아웃
@router.post("/logout", response_model=ApiResponse[None])
async def auth_logout(response: Response):
    """Refresh token 쿠키 삭제"""
    
    response.delete_cookie("refresh_token")
    
    return ApiResponse(
        success=True,
        message="로그아웃 성공"
    )


# 내 정보 조회
@router.get("/me", response_model=ApiResponse[User])
async def auth_me(current_user: User = Depends(get_current_user)):
    return ApiResponse(
        success=True,
        data=current_user,
        message="내 정보 조회 성공"
    )