import uuid
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from langchain_core.documents import Document

from src.api.schemas.user import User
from src.api.auth.auth_router import get_current_user
from src.api.archive.archive_schema import ArchiveItem, ArchiveCreate
from src.logs.log import get_logger

from src.api.agent.agent_crud import faiss_manager

logger = get_logger()
router = APIRouter(prefix="/archive", tags=["Data Archive"])

# 모든 명세서 리스트 조회
@router.get("/", response_model=List[ArchiveItem])
async def get_all_archives(current_user: User = Depends(get_current_user)):
    """
        FAISS DB에 저장된 모든 명세서 프로젝트 목록과 청크 개수, 미리보기를 반환
    """
    all_docs = list(faiss_manager.db.docstore._dict.values())
    projects = {}

    for doc in all_docs:
        pid = doc.metadata.get("project_id")
        if not pid:
            continue
            
        if pid not in projects:
            projects[pid] = {
                "project_id": pid,
                "chunk_count": 0,
                "preview": ""
            }
            
        projects[pid]["chunk_count"] += 1
        
        if doc.metadata.get("chunk_index") == 0:
            preview_text = doc.page_content[:100].replace("\n", " ") + "..."
            projects[pid]["preview"] = preview_text

    return list(projects.values())


# 특정 프로젝트 명세서 상세 조회
@router.get("/{project_id}")
async def get_archive_detail(project_id: str, current_user: User = Depends(get_current_user)):
    """
        특정 프로젝트 ID의 전체 명세서 내용을 병합하여 반환
    """

    full_text = faiss_manager.get_full_project_document(project_id)
    
    if not full_text:
        raise HTTPException(status_code=404, detail="해당 프로젝트의 명세서를 찾을 수 없습니다.")
        
    return {"project_id": project_id, "content": full_text}


# 명세서 수동 적재/업데이트
@router.post("/", status_code=status.HTTP_201_CREATED)
async def create_or_update_archive(data: ArchiveCreate, current_user: User = Depends(get_current_user)):
    """
        새로운 명세서를 수동으로 FAISS DB에 적재
    """

    try:
        faiss_manager.delete_documents_by_metadata({"project_id": data.project_id})
        
        split_texts = faiss_manager.text_splitter.split_text(data.content)
        
        docs = []
        doc_ids = [str(uuid.uuid4()) for _ in split_texts]
        
        for i, text_chunk in enumerate(split_texts):
            doc = Document(
                page_content=text_chunk,
                metadata={
                    "doc_type": "project",
                    "project_id": data.project_id,
                    "chunk_index": i,
                    "total_chunks": len(split_texts)
                }
            )
            docs.append(doc)
            
        faiss_manager.add_documents(docs, ids=doc_ids)
        logger.info(f"수동 명세서 적재 완료: {data.project_id} ({len(docs)} chunks)")
        
        return {"message": "성공적으로 적재되었습니다.", "project_id": data.project_id, "chunk_count": len(docs)}
        
    except Exception as e:
        logger.error(f"명세서 적재 실패: {e}")
        raise HTTPException(status_code=500, detail=f"데이터 적재 중 오류가 발생했습니다: {e}")


# 특정 프로젝트 명세서 삭제
@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_archive(project_id: str, current_user: User = Depends(get_current_user)):
    """
        특정 프로젝트의 명세서를 FAISS DB에서 완전히 삭제
    """
    try:
        faiss_manager.delete_documents_by_metadata({"project_id": project_id})
        logger.info(f"명세서 삭제 완료: {project_id}")
        return None
    
    except Exception as e:
        logger.error(f"명세서 삭제 실패: {e}")
        raise HTTPException(status_code=500, detail="데이터 삭제 중 오류가 발생했습니다.")