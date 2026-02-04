import sys
import os

from contextlib import asynccontextmanager
from uuid import uuid4
import logging
import time

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from motor.motor_asyncio import AsyncIOMotorClient
from beanie import init_beanie

from dotenv import load_dotenv
load_dotenv()

from src.models.log import SystemLog
from src.models.user import User
from src.models.client import Client

from src.logs.log import get_logger
from src.core.kafka_core import kafka_client
from src.logs.kafka_handler import KafkaLoggingHandler

from src.api.auth import auth_router
from src.api.logs import logs_router
from src.api.crm import crm_router
from src.api.dashboard import dashboard_router
from src.api.auth.auth_crud import create_user, get_user_by_username


sys.dont_write_bytecode = True

environment = os.getenv("environment", "development")

@asynccontextmanager
async def lifespan(app: FastAPI):

    # 로깅 시스템 초기화
    root_logger = logging.getLogger()
    kafka_handler = KafkaLoggingHandler(kafka_client, topic="system_logs")
    root_logger.addHandler(kafka_handler)

    # 3. Local Logger 초기화
    local_logger = get_logger()
    local_logger.info("Freelance-Ops-Agent 서버 시작 중...")

    # MongoDB 및 Beanie 초기화
    mongo_url = os.getenv("MONGO_URL", "mongodb://localhost:27017/agent_db")
    client = AsyncIOMotorClient(mongo_url)
    app.state.client = client
    await init_beanie(database=client.get_default_database(), document_models=[User, SystemLog, Client])

    local_logger.info("MongoDB & Beanie 초기화 완료")
    local_logger.info("Kafka 클라이언트 초기화 및 로깅 설정 완료")
    

    # 어드민 유저 초기화
    if await get_user_by_username(os.getenv("admin_username")) is None:
        await create_user(
            username=os.getenv("admin_username"),
            email=os.getenv("admin_email"),
            password=os.getenv("admin_password"),
            full_name="Administrator"
        )
        local_logger.info("어드민 유저 생성 완료")
    
    yield
    
    # 시스템 종료
    client.close()
    await kafka_client.stop()
    local_logger.info("Freelance-Ops-Agent 서버 종료")


class FreelanceOpsAgentServer:
    def __init__(self):
        self.app = FastAPI(
            title="FreelanceOpsAgent Server",
            version=os.getenv("version", "0.1.0"),
            description="FreelanceOpsAgent Server",
            lifespan=lifespan,
            # docs_url=None,
            # redoc_url=None
        )

        self._configure_middleware()
        self._register_routes()
    
    def _configure_middleware(self):

        if environment == "development":
            origins = [
                "*"
            ]
        
        else:
            origins = [
                "https://www.freelance-ops.site",
                "https://freelance-ops.site"
            ]

        self.app.add_middleware(
            CORSMiddleware,
            allow_origins=origins,
            allow_credentials=True,
            allow_methods=["GET", "POST", "PUT", "DELETE"],
            allow_headers=["Content-Type", "Authorization", "Accept"],
            max_age=3600
        )

        @self.app.middleware("http")
        async def logging_middleware(request: Request, call_next):
            should_skip_logging = (
                request.url.path in ["/health", "/version", "/favicon.ico"] or
                (request.url.path.startswith("/api/v1/logs") and request.method == "GET")
            )

            if should_skip_logging:
                return await call_next(request)

            request_id = str(uuid4())
            request.state.request_id = request_id
            
            local_logger = get_logger()
            
            start_time = time.time() 
            local_logger.info(f"START: {request.method} {request.url.path} [{request_id}]")
            
            try:
                response = await call_next(request)

                process_time = (time.time() - start_time) * 1000
                local_logger.info(
                    f"END: {response.status_code} {request.method} {request.url.path} "
                    f"({process_time:.2f}ms) [{request_id}]"
                )

                response.headers["X-Request-ID"] = request_id
                return response
            
            except Exception as e:
                local_logger.exception(f"FAIL: {request.method} {request.url.path} [{request_id}]")
                raise

    def _register_routes(self):
        @self.app.get("/version", tags=["root"])
        async def get_version():
            return {"version": os.getenv("version", "0.1.0")}
        
        @self.app.get("/health")
        async def health_check(request: Request):
            try:
                client = request.app.state.client
                await client.admin.command('ping')
                return {"status": "healthy", "database": "connected"}
            
            except Exception as e:
                return {"status": "unhealthy", "error": str(e)}, 500
                
        self.app.include_router(auth_router.router, prefix="/api/v1")
        self.app.include_router(logs_router.router, prefix="/api/v1")
        self.app.include_router(dashboard_router.router, prefix="/api/v1")
        self.app.include_router(crm_router.router, prefix="/api/v1")
        
    def get_app(self) -> FastAPI:
        return self.app
    
server_instance = FreelanceOpsAgentServer()
app = server_instance.get_app()