from typing import TypedDict, Dict, List, Optional, Literal, Annotated
import operator
from pydantic import BaseModel, Field


# ---------------------------------------
#   파서 설정
# ---------------------------------------

class RequirementAnalysis(BaseModel):
    is_sufficient: bool = Field(description="요구사항에 디스코드 봇의 핵심 기능, 타겟, 작동 방식이 명확히 포함되어 평가가 가능한 수준인지 여부")
    message: str = Field(description="is_sufficient가 False일 경우 사용자에게 부족한 정보를 구체적으로 되묻는 질문. True일 경우 분석된 기능 명세 요약문.")

class RiskScore(BaseModel):
    risk: float = Field(description="위험도", ge=0, le=1)
    reason: str = Field(description="위험도에 대한 간단한 설명")

class ModificationAnalysis(BaseModel):
    is_recoverable: bool = Field(description="수정을 통해 합법적/규정 준수 상태로 타협 및 회생이 가능한지 여부")
    message: str = Field(description="회생 불가 시 단호한 거절 사유. 회생 가능 시, 고객에게 거래를 성사시키기 위해 제안할 구체적인 기능 수정/우회 방안.")


class QueryList(BaseModel):
    queries: List[str] = Field(description="FAISS 벡터 DB 검색을 위한 5개의 독립적이고 다양한 검색 쿼리 리스트")

class WorkspaceEvaluation(BaseModel):
    score: int = Field(description="현재 요구사항과의 연관성 점수 (0~100)")
    is_relevant: bool = Field(description="연관성이 충분한지 여부 (70점 이상이면 True)")
    summary: str = Field(description="과거 프로젝트의 핵심 내용 요약 (비용, 개발 기간, 기술 스택, 주요 기능 필수 포함)")
    new_query: Optional[str] = Field(description="연관성이 낮을 경우 다시 검색할 새로운 단일 쿼리 (관련성이 높으면 빈 문자열)")

class EstimationResult(BaseModel):
    estimation_draft: str = Field(description="산출된 견적 및 기간 안내 텍스트 (마크다운 형식)")

class HallucinationEvaluation(BaseModel):
    score: float = Field(description="견적의 논리성 및 과거 데이터 반영 신뢰도 (0.0 ~ 1.0)")
    reason: str = Field(description="해당 점수를 부여한 이유")


# ---------------------------------------
#   데이터 타입 설정
# ---------------------------------------

class WorkspaceState(TypedDict):
    input_message: str
    current_query: str


class ClarificateState(TypedDict):
    input_message: str

    # 구체화 및 휴먼 피드백 수신 정의
    is_sufficient: Optional[bool]
    clarification_message: Optional[str]
    human_feedback: Optional[str]


class MainState(ClarificateState):
    output_message: Optional[str]

    project_id: Optional[str]
    is_additional_order: Optional[bool]

    # 대한민국 법률 / 디스코드 TOS 리스크 정의
    korean_law_risk: Optional[float]
    korean_law_risk_reason: Optional[str]
    discord_tos_risk: Optional[float]
    discord_tos_risk_reason: Optional[str]
    
    # 협상 및 수정 관련 변수
    is_recoverable: Optional[bool]
    modification_proposal: Optional[str]
    project_status: Optional[Literal["CONTINUE", "STOP"]]


    # 쿼리 및 병렬 검색 관련 변수
    search_queries: List[str]
    retrieved_projects: Annotated[List[str], operator.add]


    # 견적 산출 및 검사 관련 변수
    estimation_draft: Optional[str]
    hallucination_score: Optional[float]
    estimation_retry_count: int

    # 최종 확정 변수
    final_requirement_specs: Optional[str]

