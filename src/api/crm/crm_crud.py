from typing import List, Optional
from datetime import datetime
from zoneinfo import ZoneInfo
from beanie import PydanticObjectId

from src.api.crm.crm_schema import CrmProject, CrmProjectCreate, CrmProjectUpdate

async def create_project(data: CrmProjectCreate) -> CrmProject:
    new_project = CrmProject(**data.model_dump())
    await new_project.insert()
    return new_project

async def get_all_projects(skip: int = 0, limit: int = 50, status: Optional[str] = None) -> List[CrmProject]:
    query = CrmProject.find()
    if status:
        query = CrmProject.find(CrmProject.status == status)
    
    return await query.sort(-CrmProject.created_at).skip(skip).limit(limit).to_list()

async def get_project_by_id(project_id: PydanticObjectId) -> Optional[CrmProject]:
    return await CrmProject.get(project_id)

async def update_project(project_id: PydanticObjectId, data: CrmProjectUpdate) -> Optional[CrmProject]:
    project = await CrmProject.get(project_id)
    if not project:
        return None

    update_data = data.model_dump(exclude_unset=True)
    if update_data:
        for key, value in update_data.items():
            setattr(project, key, value)
        project.updated_at = datetime.now(tz=ZoneInfo("Asia/Seoul"))
        await project.save()
        
    return project

async def delete_project(project_id: PydanticObjectId) -> bool:
    project = await CrmProject.get(project_id)
    if not project:
        return False
    await project.delete()
    return True