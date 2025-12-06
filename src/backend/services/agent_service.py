from src.core.domain import ProjectSpec

class AgentService:
    async def run_analysis(self, raw_text: str) -> dict:
        # [TODO] 실제 Agent invoke 호출
        # result = await agent_app.ainvoke({"raw_spec": raw_text})
        
        return {
            "status": "completed",
            "project_name": "임시 프로젝트",
            "price": 500000
        }

agent_service = AgentService()