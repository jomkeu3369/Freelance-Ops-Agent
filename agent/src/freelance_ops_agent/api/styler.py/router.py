import os
import sys

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse

from src.api.auth.auth_router import get_current_user

'''
    스타일러 시스템은 사용자의 쿼리를 톤앤매너 및 스타일에 맞게 변환하는 역할을 수행함.
    스타일은 지정된 스타일이 있고, 사용자 커스텀이 존재함    
'''


router = APIRouter(prefix="/styler", tags=["styler"])

@router.post("/styler", response_model=StylerResponse)
async def rewrite_tone_and_manner(request: StylerRequest, current_user: User = Depends(get_current_user)):
    """
        톤앤매너 변환 API 엔드포인트
    """
    try:
        styled_text = await generate_styled_text(
            customer_message=request.customer_message,
            original_text=request.original_text,
            tone=request.tone
        )
        return StylerResponse(styled_text=styled_text)
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))