import os

import json
import asyncio

from datetime import datetime

from aiokafka import AIOKafkaConsumer
from dotenv import load_dotenv

from motor.motor_asyncio import AsyncIOMotorClient
from beanie import init_beanie

from src.logs.log import get_logger
from src.models.log import SystemLog


logger = get_logger()
load_dotenv()

async def log_aggregator():
    consumer = AIOKafkaConsumer(
        "system_logs",
        bootstrap_servers=os.getenv("KAFKA_BOOTSTRAP_SERVERS", "localhost:9092"),
        group_id="log_aggregator_group"
    )
    await consumer.start()
    
    try:
        async for msg in consumer:
            log_data = json.loads(msg.value.decode('utf-8'))
            
            log_entry = SystemLog(
                level=log_data.get("level"),
                logger=log_data.get("logger"),
                message=log_data.get("message"),
                file_info=log_data.get("file"),
                time=datetime.fromisoformat(log_data.get("time")),
                service="backend"
            )
            
            await log_entry.insert()

    except Exception as e:
        logger.error(f"Log Aggregator Error: {e}")

    finally:
        await consumer.stop()

async def consume_login_events():
    bootstrap_servers = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "localhost:9092")
    
    consumer = AIOKafkaConsumer(
        "user_login_events",
        bootstrap_servers=bootstrap_servers,
        group_id="auth_event_group",
        value_deserializer=lambda v: json.loads(v.decode('utf-8')),
        auto_offset_reset="earliest"
    )
    
    await consumer.start()
    logger.info(f"📡 Worker Listening on {bootstrap_servers}...")
    
    try:
        async for msg in consumer:
            event = msg.value
            logger.info(f"[KAFKA EVENT] 로그인 감지: {event['username']} (시간: {event['event_time']})")
 
    except Exception as e:
        logger.error(f"❌ Worker Error: {e}")
    finally:
        await consumer.stop()

async def main():
    mongo_url = os.getenv("MONGO_URL", "mongodb://localhost:27017/agent_db")
    client = AsyncIOMotorClient(mongo_url)

    await init_beanie(database=client.get_default_database(), document_models=[SystemLog])

    await asyncio.gather(
        log_aggregator(),
        consume_login_events()
    )

if __name__ == "__main__":
    asyncio.run(main())