import os
import sys

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from freelance_ops_agent import __version__
from freelance_ops_agent.config import get_settings
from freelance_ops_agent.contracts import HealthResponse

'''
    [ AI 모델 서빙 서버 ]
    
    1. workspace chat (user)
        1. LLM 분류기 (요청에 따라서 적절한 모델로 라우팅)
            1. 단순 질문
                - GPT 5.6 LUNA 기반의 REPETER RAG 기법 도입
            
            2. 제작할 기능에 대한 요구사항 입력
                - Supervisor 구조의 워크스페이스 작동
                    - 메인 오케스트레이터
                        - 요구사항 분석 슈퍼바이저
                        - 리스크 분석 슈퍼바이저
            
            3. 그 외의 질문 ( 추가 사항 등에 대해서 처리 )
                - React 기반의 Agent 구조로 라우팅
                - 도구의 경우 Supervisor 구조보다 추상화하고, 경우에 따라 swap 구조를 적용하여 Supervisor 구조 또는 단순 LLM으로 라우팅
                    - 데이터베이스 조회 도구
                    - 웹 검색 도구
                    
                - 현 프로젝트와 연관성이 매우 떨어지는 경우에는 출력 거절 메시지를 띄우고 종료.
    
    
'''

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup logic here
    yield
    # Shutdown logic here
    
class FreelanceOpsAgentAiServer(FastAPI):
    def __init__(self):
        super().__init__(
            title="Freelance Ops Agent AI Server",
            description="Freelance Ops Agent Server",
            version=get_settings().service_version,
            lifespan=lifespan
        )
        
    def _register_routes(self):
        @self.app.get("/version", tags=["root"])
        async def get_version():
            return {"version": get_settings().service_version}

app = FreelanceOpsAgentAiServer()
