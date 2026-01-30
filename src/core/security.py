import os
from dotenv import load_dotenv

from datetime import datetime, timedelta
from typing import Optional, Dict

from jose import jwt, JWTError
from passlib.context import CryptContext

load_dotenv()

ACCESS_TOKEN_EXPIRE_MINUTES = os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", 30)
SECRET_KEY = os.getenv("SECRET_KEY")
ALGORITHM = os.getenv("ALGORITHM")
REFRESH_TOKEN_EXPIRE_DAYS = os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", 7)

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)

def create_access_token(data: dict):
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=int(ACCESS_TOKEN_EXPIRE_MINUTES))
        
    to_encode.update({"exp": expire, "type": "access"})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

def create_refresh_token(data: dict):
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(days=int(REFRESH_TOKEN_EXPIRE_DAYS))
        
    to_encode.update({"exp": expire, "type": "refresh"})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

def verify_refresh_token(token: str) -> Optional[Dict]:
    """
    Refresh Token 검증
    
    Returns: 
        Dict: 유효한 경우 payload 반환 (sub, exp, type 등)
        None: 유효하지 않은 경우
    """
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        
        token_type: str = payload.get("type")
        if token_type != "refresh":
            return None
        
        username: str = payload.get("sub")
        if username is None:
            return None
        
        return payload
        
    except JWTError:
        return None
    
    except Exception:
        return None
    
def verify_access_token(token: str) -> Optional[Dict]:
    """
    Access Token 검증 (선택적 구현)
    
    Returns:
        Dict: 유효한 경우 payload 반환
        None: 유효하지 않은 경우
    """
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        
        token_type: str = payload.get("type")
        if token_type != "access":
            return None
        
        username: str = payload.get("sub")
        if username is None:
            return None
        
        return payload
        
    except JWTError:
        return None
    
    except Exception:
        return None