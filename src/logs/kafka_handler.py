import logging
import asyncio

from datetime import datetime

from src.core.kafka_core import KafkaManager

class KafkaLoggingHandler(logging.Handler):
    def __init__(self, kafka_client: KafkaManager, topic="system_logs"):
        super().__init__()
        self.kafka_client = kafka_client
        self.topic = topic

    def emit(self, record):

        # 로그 루프백 방지
        if "aiokafka" in record.name or "kafka" in record.name:
            return

        try:
            log_entry = {
                "level": record.levelname,
                "logger": record.name,
                "message": record.getMessage(),
                "time": datetime.fromtimestamp(record.created).isoformat(),
                "file": f"{record.filename}:{record.lineno}"
            }

            # 비동기적으로 카프카에 로그 전송
            loop = asyncio.get_running_loop()
            if loop.is_running():
                loop.create_task(self.kafka_client.send_event(self.topic, log_entry))

        except Exception:
            self.handleError(record)