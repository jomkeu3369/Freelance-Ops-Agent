import sys
import logging
from logging.handlers import TimedRotatingFileHandler
from pathlib import Path

from rich.logging import RichHandler

sys.dont_write_bytecode = True

RICH_FORMAT = "[%(filename)s:%(lineno)s] >> %(message)s"
FILE_HANDLER_FORMAT = "[%(asctime)s] %(levelname)s [%(filename)s:%(funcName)s:%(lineno)s] >> %(message)s"

LOG_PATH = Path(__file__).parent.parent / "logs_data"
LOG_PATH.mkdir(exist_ok=True)

LOGGER_NAME = "freelance_ops"

def setup_logging() -> logging.Logger:
    logger = logging.getLogger(LOGGER_NAME)
    logger.setLevel(logging.INFO)
    
    if logger.handlers:
        return logger

    rich_handler = RichHandler(rich_tracebacks=True)
    rich_handler.setFormatter(logging.Formatter(RICH_FORMAT))
    logger.addHandler(rich_handler)

    log_filename = LOG_PATH / "server.log"
    
    file_handler = TimedRotatingFileHandler(
        filename=log_filename,
        when="midnight",
        interval=1,
        backupCount=7,
        encoding="utf-8"
    )
    file_handler.suffix = "%Y%m%d"
    file_handler.setFormatter(logging.Formatter(FILE_HANDLER_FORMAT))
    
    logger.addHandler(file_handler)

    return logger

def get_logger() -> logging.Logger:
    return setup_logging()

def handle_exception(exc_type, exc_value, exc_traceback):
    if issubclass(exc_type, KeyboardInterrupt):
        sys.__excepthook__(exc_type, exc_value, exc_traceback)
        return

    logger = setup_logging()
    logger.error("Unexpected exception", exc_info=(exc_type, exc_value, exc_traceback))

sys.excepthook = handle_exception