import json

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse

from src.api.schemas.user import User
from src.api.auth.auth_router import get_current_user
from src.api.agent.agent_schema import StreamRequest, FeedbackRequest, StylerRequest, StylerResponse
from src.api.agent.styler_service import generate_styled_text

from src.models.model import graph

router = APIRouter(prefix="/agent", tags=["agent"])

@router.post("/stream/{thread_id}")
async def stream_agent(thread_id: str, request: StreamRequest, current_user: User = Depends(get_current_user)):
    """
        클라이언트가 에이전트에게 견적을 요청하는 엔드포인트        
    """
    config = {"configurable": {"thread_id": thread_id}}

    async def event_generator():
        try:
            state_snapshot = graph.get_state(config)
            
            is_resuming = len(state_snapshot.next) > 0
            if is_resuming:
                input_data = None
            else:
                input_data = {}
                if request.message:
                    input_data["input_message"] = request.message

                if request.project_id:
                    input_data["project_id"] = request.project_id
                    
                if request.is_additional_order:
                    input_data["is_additional_order"] = request.is_additional_order
                
                if not input_data:
                    input_data = None
            
            async for event in graph.astream(input_data, config, stream_mode="updates"):
                for node_name, node_data in event.items():
                    log_data = {"node": node_name, "message": f"{node_name} 작업 완료"}
                    yield f"event: node\ndata: {json.dumps(log_data, ensure_ascii=False)}\n\n"
                
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"

            current_state_snapshot = graph.get_state(config)
            
            if "clariffication_feedback" in current_state_snapshot.next:
                question = current_state_snapshot.values.get("clarification_message", "질문 내용을 찾을 수 없습니다.")
                yield f"event: hitl\ndata: {json.dumps({'node': 'clariffication_feedback', 'status': 'waiting_for_user', 'question': question}, ensure_ascii=False)}\n\n"

            elif "modification_feedback" in current_state_snapshot.next:
                proposal = current_state_snapshot.values.get("modification_proposal", "제안 내용을 찾을 수 없습니다.")
                yield f"event: hitl\ndata: {json.dumps({'node': 'modification_feedback', 'status': 'waiting_for_user', 'question': proposal}, ensure_ascii=False)}\n\n"

            elif "estimation_hitl" in current_state_snapshot.next:
                draft = current_state_snapshot.values.get("estimation_draft", "견적을 찾을 수 없습니다.")
                hitl_message = f"### 📋 견적 산출안\n{draft}\n\n**이 견적으로 진행하시겠습니까? (추가 요구사항 또는 'STOP' 입력)**"
                
                yield f"event: hitl\ndata: {json.dumps({'node': 'estimation_hitl', 'status': 'waiting_for_user', 'question': hitl_message}, ensure_ascii=False)}\n\n"

            else:
                yield "event: end\ndata: {}\n\n"

        except Exception as e:
            yield f"event: error\ndata: {json.dumps({'error': str(e)})}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.post("/resume/{thread_id}")
async def resume_agent(thread_id: str, request: FeedbackRequest, current_user: User = Depends(get_current_user)):
    """
        에이전트의 HITL 피드백을 처리하는 엔드포인트
    """
    
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


@router.post("/styler", response_model=StylerResponse)
async def rewrite_tone_and_manner(request: StylerRequest, current_user: User = Depends(get_current_user)):
    """
        사용자의 텍스트를 요청된 톤앤매너로 변환하는 엔드포인트
    """

    try:
        styled_text = await generate_styled_text(
            customer_message=request.customer_message,
            original_text=request.original_text,
            tone=request.tone
        )
        return StylerResponse(styled_text=styled_text)
    
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="텍스트 톤앤매너 변환 중 서버 오류가 발생했습니다."
        )