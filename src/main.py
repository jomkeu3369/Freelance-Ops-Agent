import sys
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from dotenv import load_dotenv
load_dotenv()

# from src.api import router
# from src.logs.log import setup_logging, handle_exception

sys.dont_write_bytecode = True

class FreelanceOpsAgentServer:
    def __init__(self):
        # self.logger = setup_logging()
        # sys.excepthook = handle_exception

        self.app = FastAPI(
            title="FreelanceOpsAgent Server",
            version=os.getenv("version", "0.1.0"),
            description="FreelanceOpsAgent Server",
        )

        self._configure_cors()
        self._register_routes()

    def _configure_cors(self):
        origins = ["*"]

        self.app.add_middleware(
            CORSMiddleware,
            allow_origins=origins,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    def _register_routes(self):

        @self.app.get("/version", tags=["root"])
        async def get_version():
            return {"version": os.getenv("version", "0.1.0")}

        # self.app.include_router(router.router)

    def get_app(self) -> FastAPI:
        return self.app
    
server_instance = FreelanceOpsAgentServer()
app = server_instance.get_app()