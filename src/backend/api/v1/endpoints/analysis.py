from fastapi import APIRouter, Depends
from src.backend.schemas.request import AnalyzeRequest
from src.backend.services.agent_service import agent_service, AgentService

router = APIRouter()

@router.post("/analyze")
async def analyze_spec(request: AnalyzeRequest, service: AgentService = Depends(lambda: agent_service)):
    result = await service.run_analysis(request.raw_spec_text)
    return result