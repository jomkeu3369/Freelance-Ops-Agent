from pydantic import BaseModel, Field

from typing import Optional


class FeedbackRequest(BaseModel):
    feedback: str

class StreamRequest(BaseModel):
    message: Optional[str] = None
    
    project_id: Optional[str] = Field(default=None, description="CRM 프로젝트 ID")
    is_additional_order: Optional[bool] = Field(default=False, description="추가 주문 여부")


class StylerRequest(BaseModel):
    customer_message: str = Field(default="", description="고객이 보낸 원본 메시지")
    
    original_text: str = Field(..., description="사용자가 입력한 답변 메시지")
    tone: str = Field(..., description="적용할 톤앤매너")

class StylerResponse(BaseModel):
    styled_text: str = Field(..., description="톤앤매너가 변환된 결과 텍스트")