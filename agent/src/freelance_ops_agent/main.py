import os
import sys

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from freelance_ops_agent import __version__
from freelance_ops_agent.config import get_settings
from freelance_ops_agent.contracts import HealthResponse


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
