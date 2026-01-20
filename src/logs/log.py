import sys
import logging
from datetime import datetime
from pathlib import Path

from fastapi import Request
from rich.logging import RichHandler
import structlog

sys.dont_write_bytecode = True

RICH_FORMAT = "[%(filename)s:%(lineno)s] >> %(message)s"
FILE_HANDLER_FORMAT = (
    "[%(asctime)s] %(levelname)s [%(filename)s:%(funcName)s:%(lineno)s] >> %(message)s"
)

LOG_PATH = Path(__file__).parent.parent / "logs"
LOG_PATH.mkdir(exist_ok=True)

def init_logging() -> logging.Logger:
    """
    기본 로깅 시스템 초기화
    """

    log_filename = f"{datetime.now():%Y%m%d}_log.txt"
    log_filepath = LOG_PATH / log_filename
    
    logging.basicConfig(
        level=logging.INFO, 
        format=RICH_FORMAT, 
        handlers=[RichHandler(rich_tracebacks=True)]
    )
    
    file_handler = logging.FileHandler(log_filepath, mode="a", encoding="utf-8")
    file_handler.setFormatter(logging.Formatter(FILE_HANDLER_FORMAT))
    
    root_logger = logging.getLogger()
    root_logger.addHandler(file_handler)
    
    app_logger = logging.getLogger("pbl2ai")
    app_logger.setLevel(logging.INFO)
    
    return app_logger

class ContextualLogger:
    """
    Request 정보를 포함하여 로그를 넘기기 위한 클래스
    """
    def __init__(self, logger: logging.Logger, request_id: str, path: str, method: str, client_ip: str):
        self.logger = logger
        self.request_id = request_id
        self.path = path
        self.method = method
        self.client_ip = client_ip
    
    def _format_message(self, msg: str) -> str:
        return (
            f"[{self.request_id}] "
            f"[{self.method} {self.path}] "
            f"[{self.client_ip}] "
            f"{msg}"
        )
    
    def debug(self, msg: str, *args, **kwargs):
        self.logger.debug(self._format_message(msg), *args, **kwargs)
    
    def info(self, msg: str, *args, **kwargs):
        self.logger.info(self._format_message(msg), *args, **kwargs)
    
    def warning(self, msg: str, *args, **kwargs):
        self.logger.warning(self._format_message(msg), *args, **kwargs)
    
    def error(self, msg: str, *args, **kwargs):
        self.logger.error(self._format_message(msg), *args, **kwargs)
    
    def critical(self, msg: str, *args, **kwargs):
        self.logger.critical(self._format_message(msg), *args, **kwargs)
    
    def exception(self, msg: str, *args, **kwargs):
        self.logger.exception(self._format_message(msg), *args, **kwargs)


def get_base_logger() -> logging.Logger:
    """
    Request 컨텍스트가 필요 없는 경우 사용하는 기본 logger
    """
    return logging.getLogger("pbl2ai")

def get_contextual_logger(request: Request) -> ContextualLogger:
    """
    Request 정보를 포함한 ContextualLogger를 반환하는 Dependency
    """
    import uuid
    
    request_id = getattr(request.state, "request_id", str(uuid.uuid4()))
    client_ip = request.client.host if request.client else "unknown"
    base_logger = logging.getLogger("pbl2ai")
    
    return ContextualLogger(
        logger=base_logger,
        request_id=request_id,
        path=request.url.path,
        method=request.method,
        client_ip=client_ip
    )


def init_structlog():
    """
    JSON 형식 등 구조화된 로그를 위한 structlog 초기화
    """
    structlog.configure(
        processors=[
            structlog.stdlib.filter_by_level,
            structlog.stdlib.add_logger_name,
            structlog.stdlib.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            structlog.processors.UnicodeDecoder(),
            structlog.processors.JSONRenderer()
        ],
        context_class=dict,
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )

def get_structlog_logger(request: Request) -> structlog.stdlib.BoundLogger:
    """
    structlog을 이용한 구조화된 logger를 반환하는 Dependency
    """
    logger = structlog.get_logger("pbl2ai")
    
    return logger.bind(
        request_id=getattr(request.state, "request_id", "unknown"),
        path=request.url.path,
        method=request.method,
        client_ip=request.client.host if request.client else "unknown"
    )

def handle_exception(exc_type, exc_value, exc_traceback):
    """
    처리되지 않은 예외를 로깅하기 위한 핸들러
    """
    logger = logging.getLogger("pbl2ai")
    logger.error("Unexpected exception", exc_info=(exc_type, exc_value, exc_traceback))