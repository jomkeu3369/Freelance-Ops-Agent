import json
from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from src.models.model import graph
from src.api.agent.agent_schema import StreamRequest, FeedbackRequest

router = APIRouter(prefix="/agent", tags=["agent"])

@router.post("/stream/{thread_id}")
async def stream_agent(thread_id: str, request: StreamRequest):
    config = {"configurable": {"thread_id": thread_id}}
    message = request.message

    async def event_generator():
        try:
            input_data = {"input_message": message} if message else None
            
            async for event in graph.astream(input_data, config, stream_mode="updates"):
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
            
            state_snapshot = graph.get_state(config)
            
            if "clariffication_feedback" in state_snapshot.next:
                question = state_snapshot.values.get("clarification_message", "질문 내용을 찾을 수 없습니다.")
                yield f"event: hitl\ndata: {json.dumps({'status': 'waiting_for_user', 'question': question}, ensure_ascii=False)}\n\n"

            elif "modification_feedback" in state_snapshot.next:
                proposal = state_snapshot.values.get("modification_proposal", "제안 내용을 찾을 수 없습니다.")
                yield f"event: hitl\ndata: {json.dumps({'status': 'waiting_for_user', 'question': proposal}, ensure_ascii=False)}\n\n"

            elif "estimation_hitl" in state_snapshot.next:
                draft = state_snapshot.values.get("estimation_draft", "견적을 찾을 수 없습니다.")
                hitl_message = f"[견적서 도착]\n{draft}\n\n이 견적으로 진행하시겠습니까? (네고 제안 또는 'STOP' 입력)"
                
                yield f"event: hitl\ndata: {json.dumps({'status': 'waiting_for_user', 'question': hitl_message}, ensure_ascii=False)}\n\n"

            else:
                yield "event: end\ndata: {}\n\n"

        except Exception as e:
            yield f"event: error\ndata: {json.dumps({'error': str(e)})}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.post("/resume/{thread_id}")
async def resume_agent(thread_id: str, request: FeedbackRequest):
    config = {"configurable": {"thread_id": thread_id}}
    state_snapshot = graph.get_state(config)
    
    if ("clariffication_feedback" not in state_snapshot.next and 
        "modification_feedback" not in state_snapshot.next and 
        "estimation_hitl" not in state_snapshot.next):
        return {"status": "error", "message": "현재 피드백을 대기 중인 상태가 아닙니다."}

    graph.update_state(config, {"human_feedback": request.feedback})
    
    return {
        "status": "success", 
        "message": "피드백이 반영되었습니다. /stream으로 다시 연결하여 진행하세요."
    }