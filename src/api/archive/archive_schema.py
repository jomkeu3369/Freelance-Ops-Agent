from pydantic import BaseModel, Field

class ArchiveItem(BaseModel):
    project_id: str = Field(..., description="프로젝트 ID")
    chunk_count: int = Field(..., description="분할된 청크 개수")
    preview: str = Field(..., description="명세서 내용 미리보기")

class ArchiveCreate(BaseModel):
    project_id: str = Field(..., description="저장할 프로젝트 ID")
    content: str = Field(..., description="저장할 명세서 전체 텍스트")