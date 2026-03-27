import asyncio

from typing import Any, Dict, Optional
from src.logs.log import get_logger

logger = get_logger()

class SessionManager:
    _instance: Optional['SessionManager'] = None
    _initialized: bool = False

    def __new__(cls, *args, **kwargs) -> 'SessionManager':
        if cls._instance is None:
            logger.debug("새로운 SessionManager 인스턴스를 생성합니다.")
            cls._instance = super(SessionManager, cls).__new__(cls)
        return cls._instance

    def __init__(self):
        if SessionManager._initialized:
            return
        logger.debug("SessionManager 인스턴스를 초기화합니다.")
        self.sessions: Dict[str, Dict[str, Any]] = {}
        SessionManager._initialized = True

    def get_session(self, session_id: str) -> Dict[str, Any]:
        """지정된 session_id에 대한 세션 데이터를 가져오거나 생성합니다."""

        if session_id not in self.sessions:
            logger.info(f"세션 ID '{session_id}'에 대한 새 세션 항목을 생성합니다.")
            self.sessions[session_id] = {
                "feedback_event": asyncio.Event(),
                "feedback_data": None,
            }
        else:
            logger.debug(f"세션 ID '{session_id}'에 대한 기존 세션에 접근합니다.")
        return self.sessions[session_id]

    def set_feedback(self, session_id: str, feedback: Optional[Any]):
        """세션에 피드백 데이터를 설정하고 이벤트를 트리거합니다."""

        session = self.get_session(session_id)
        session["feedback_data"] = feedback
        session["feedback_event"].set()
        logger.info(f"세션 ID '{session_id}'에 피드백이 설정되었습니다.")

    async def wait_for_feedback(self, session_id: str, timeout: float) -> Optional[Any]:
        """지정된 시간 동안 세션 피드백을 기다립니다."""

        session = self.get_session(session_id)

        session["feedback_event"].clear()
        session["feedback_data"] = None 
        
        logger.debug(f"세션 ID '{session_id}'의 피드백을 {timeout}초 동안 기다립니다.")
        try:
            await asyncio.wait_for(session["feedback_event"].wait(), timeout=timeout)
            logger.info(f"세션 ID '{session_id}'에 대한 피드백을 받았습니다.")
            return session["feedback_data"]
        
        except asyncio.TimeoutError:
            logger.warning(f"세션 ID '{session_id}'의 피드백 대기 시간 초과.")
            return None
    
    def cleanup_session(self, session_id: str):
        """세션 ID와 관련된 데이터를 정리합니다."""
        
        if session_id in self.sessions:
            logger.info(f"세션 ID '{session_id}'를 정리합니다.")
            del self.sessions[session_id]
        else:
            logger.warning(f"존재하지 않는 세션 ID '{session_id}'의 정리를 시도했습니다.")

session_manager = SessionManager()