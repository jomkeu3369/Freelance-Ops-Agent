import logging
import asyncio

from datetime import datetime
from src.core.kafka_core import KafkaManager

class KafkaLoggingHandler(logging.Handler):
    def __init__(self, kafka_client: KafkaManager, topic="system_logs"):
        super().__init__()
        self.kafka_client = kafka_client
        self.topic = topic
        
        try:
            self.main_loop = asyncio.get_running_loop()
        except RuntimeError:
            self.main_loop = asyncio.get_event_loop()

    def emit(self, record):
        try:
            msg_dict = {
                "timestamp": datetime.now().isoformat(),
                "level": record.levelname,
                "message": self.format(record),
                "logger": record.name
            }

            try:
                current_loop = asyncio.get_running_loop()
            except RuntimeError:
                current_loop = None

            if current_loop and current_loop.is_running():
                current_loop.create_task(self.kafka_client.send_event(self.topic, msg_dict))
            else:
                asyncio.run_coroutine_threadsafe(
                    self.kafka_client.send_event(self.topic, msg_dict), 
                    self.main_loop
                )
        except Exception:
            self.handleError(record)