from datetime import datetime
from zoneinfo import ZoneInfo
from typing import Optional
from enum import Enum

from beanie import Document
from pydantic import BaseModel, Field

def get_kst_now():
    return datetime.now(tz=ZoneInfo("Asia/Seoul"))

# ---------------------------------------
#   Enum
# ---------------------------------------

class ProjectCategory(str, Enum):
    DISCORD_BOT = "Discord Bot"
    WEB_APP = "Web App"
    RPA = "RPA"
    CONSULTING = "Consulting"
    OTHER = "Other"

class ProjectStatus(str, Enum):
    LEAD = "LEAD"               # 문의 접수 (초기)
    NEGOTIATING = "NEGOTIATING" # 견적 협의 및 네고 중
    IN_PROGRESS = "IN_PROGRESS" # 개발 진행 중
    COMPLETED = "COMPLETED"     # 타결 및 개발 완료
    CANCELLED = "CANCELLED"     # 취소/드랍


# ---------------------------------------
#   DB Document 모델
# ---------------------------------------

class CrmProject(Document):
    client_name: str = Field(..., description="고객명")
    contact_info: Optional[str] = Field(default=None, description="연락처 (이메일 또는 디스코드 ID)")
    
    project_title: str = Field(..., description="프로젝트명")
    category: ProjectCategory = Field(default=ProjectCategory.OTHER, description="프로젝트 카테고리")
    status: ProjectStatus = Field(default=ProjectStatus.LEAD, description="현재 진행 상태")
    
    estimated_price: int = Field(default=0, description="제안 견적가")
    final_price: int = Field(default=0, description="최종 타결가")
    
    requirements: Optional[str] = Field(default=None, description="요구사항 메모")
    
    created_at: datetime = Field(default_factory=get_kst_now)
    updated_at: datetime = Field(default_factory=get_kst_now)

    class Settings:
        name = "crm_projects"


# ---------------------------------------
#   API 요청/응답 스키마
# ---------------------------------------

class CrmProjectCreate(BaseModel):
    client_name: str
    contact_info: Optional[str] = None
    project_title: str
    category: ProjectCategory
    estimated_price: int = 0
    requirements: Optional[str] = None

class CrmProjectUpdate(BaseModel):
    client_name: Optional[str] = None
    contact_info: Optional[str] = None
    project_title: Optional[str] = None
    category: Optional[ProjectCategory] = None
    status: Optional[ProjectStatus] = None
    estimated_price: Optional[int] = None
    final_price: Optional[int] = None
    requirements: Optional[str] = None