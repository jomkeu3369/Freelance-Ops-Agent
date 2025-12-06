from pydantic import BaseModel, Field
from typing import List, Dict, Optional

class ProjectSpec(BaseModel):
    project_name: str = Field(description="프로젝트 제목")
    
    # 1. 예산/견적 분리
    client_budget: Optional[int] = Field(description="고객이 제시한 예산 (없으면 0)")
    estimated_price: int = Field(description="AI가 분석한 적정 견적 (현실적인 금액)")
    
    # 2. 계산을 위한 정형 데이터
    complexity_score: int = Field(description="1~10 난이도 점수")
    estimated_duration: int = Field(description="예상 소요 일수")
    
    # 3. 텍스트 분석 데이터
    technical_risks: List[str] = Field(description="기술적 리스크 목록")
    recommended_stack: List[str] = Field(description="추천 기술 스택 (예: ['SQLite', 'Discord.py'])")
    
    # 종합 의견
    overall_reasoning: str = Field(description="견적 산출의 종합적인 근거")

