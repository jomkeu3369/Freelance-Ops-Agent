import sys
import os

from contextlib import asynccontextmanager
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from motor.motor_asyncio import AsyncIOMotorClient
from beanie import init_beanie

from dotenv import load_dotenv
load_dotenv()

# from src.api import router
from src.logs.log import get_logger
# from src.models.requirement import Requirement

sys.dont_write_bytecode = True

@asynccontextmanager
async def lifespan(app: FastAPI):

    # 로깅 시스템 초기화
    logger = get_logger()
    logger.info("Freelance-Ops-Agent 서버 시작")

    # MongoDB 및 Beanie 초기화
    mongo_url = os.getenv("MONGO_URL", "mongodb://localhost:27017/agent_db")
    client = AsyncIOMotorClient(mongo_url)
    app.state.client = client


    await init_beanie(database=client.get_default_database(), document_models=[])
    logger.info("MongoDB & Beanie 초기화 완료")
    
    yield
    
    # 시스템 종료
    client.close()
    logger.info("Freelance-Ops-Agent 서버 종료")


class FreelanceOpsAgentServer:
    def __init__(self):
        self.app = FastAPI(
            title="FreelanceOpsAgent Server",
            version=os.getenv("version", "0.1.0"),
            description="FreelanceOpsAgent Server",
            lifespan=lifespan
        )

        self._configure_middleware()
        self._register_routes()
    
    def _configure_middleware(self):
        origins = [
            "*"
        ]

        self.app.add_middleware(
            CORSMiddleware,
            allow_origins=origins,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

        @self.app.middleware("http")
        async def logging_middleware(request: Request, call_next):
            request_id = str(uuid4())
            request.state.request_id = request_id
            
            logger = get_logger()
            logger.info(f"START: {request.method} {request.url.path} [{request_id}]")
            
            try:
                response = await call_next(request)
                logger.info(f"END: {response.status_code} [{request_id}]")

                response.headers["X-Request-ID"] = request_id
                return response
            except Exception as e:
                logger.exception(f"FAIL: [{request_id}]")
                raise

    def _register_routes(self):
        @self.app.get("/version", tags=["root"])
        async def get_version():
            return {"version": os.getenv("version", "0.1.1")}
        
        @self.app.get("/health")
        async def health_check(request: Request):
            try:
                client = request.app.state.client
                await client.admin.command('ping')
                return {"status": "healthy", "database": "connected"}
            except Exception as e:
                return {"status": "unhealthy", "error": str(e)}, 500
                
        # self.app.include_router(router.router)

    def get_app(self) -> FastAPI:
        return self.app
    
server_instance = FreelanceOpsAgentServer()
app = server_instance.get_app()