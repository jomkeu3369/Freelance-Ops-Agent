from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from beanie import PydanticObjectId

from src.api.schemas.user import User
from src.api.auth.auth_router import get_current_user
from src.api.crm.crm_schema import CrmProject, CrmProjectCreate, CrmProjectUpdate
from src.api.crm import crm_crud

router = APIRouter(prefix="/crm", tags=["CRM"])

# 프로젝트 생성
@router.post("/", response_model=CrmProject, status_code=status.HTTP_201_CREATED)
async def create_new_project(
    project_data: CrmProjectCreate,
    current_user: User = Depends(get_current_user)
):
    return await crm_crud.create_project(project_data)

# 프로젝트 리스트 조회
@router.get("/", response_model=List[CrmProject])
async def read_projects(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, le=100),
    status: Optional[str] = Query(None, description="상태별 필터 (예: IN_PROGRESS)"),
    current_user: User = Depends(get_current_user)
):
    return await crm_crud.get_all_projects(skip=skip, limit=limit, status=status)

# 특정 프로젝트 상세 조회
@router.get("/{project_id}", response_model=CrmProject)
async def read_project_detail(
    project_id: PydanticObjectId,
    current_user: User = Depends(get_current_user)
):
    project = await crm_crud.get_project_by_id(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다.")
    return project

# 프로젝트 수정
@router.put("/{project_id}", response_model=CrmProject)
async def update_existing_project(
    project_id: PydanticObjectId,
    update_data: CrmProjectUpdate,
    current_user: User = Depends(get_current_user)
):
    updated_project = await crm_crud.update_project(project_id, update_data)
    if not updated_project:
        raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다.")
    return updated_project

# 프로젝트 삭제
@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_existing_project(
    project_id: PydanticObjectId,
    current_user: User = Depends(get_current_user)
):
    success = await crm_crud.delete_project(project_id)
    if not success:
        raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다.")
    return None