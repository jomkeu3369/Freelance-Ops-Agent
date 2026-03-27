import os
import json
import asyncio
from aiokafka import AIOKafkaProducer
from aiokafka.errors import KafkaConnectionError
from dotenv import load_dotenv

from src.logs.log import get_logger

logger = get_logger()
load_dotenv()

class KafkaManager:
    def __init__(self):
        self.producer = None
        self.server = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "localhost:9092")

    async def start(self):
        if not self.producer:
            self.producer = AIOKafkaProducer(
                bootstrap_servers=self.server,
                value_serializer=lambda v: json.dumps(v).encode('utf-8')
            )
            
            retries = 0
            max_retries = 10
            while retries < max_retries:
                try:
                    await self.producer.start()
                    logger.info("✅ Kafka Producer Connected!")
                    return
                except KafkaConnectionError:
                    retries += 1
                    logger.warning(f"⚠️ Kafka 연결 실패. 재시도 중... ({retries}/{max_retries})")
                    await asyncio.sleep(3)
                except Exception as e:
                    logger.error(f"❌ Kafka Unexpected Error: {e}")
                    raise e
            
            logger.error("❌ Kafka 연결 실패: 최대 재시도 횟수 초과")
            raise KafkaConnectionError("Kafka not available")

    async def stop(self):
        if self.producer:
            await self.producer.stop()
            self.producer = None

    async def send_event(self, topic: str, message: dict):
        if not self.producer:
            await self.start()
        try:
            await self.producer.send_and_wait(topic, message)
        except Exception as e:
            print(f"Critical Kafka Send Error: {e}")

# 전역 인스턴스
kafka_client = KafkaManager()