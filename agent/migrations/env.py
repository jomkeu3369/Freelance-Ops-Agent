from __future__ import annotations

import asyncio
import os
from logging.config import fileConfig

from alembic import context
from sqlalchemy import pool, text
from sqlalchemy.ext.asyncio import async_engine_from_config

from infrastructure.database.models import AgentRuntimeBase

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = AgentRuntimeBase.metadata


def database_url() -> str:
    value = os.getenv("AGENT_DATABASE_URL")
    if value is None or not value.strip():
        raise RuntimeError("AGENT_DATABASE_URL is required for Agent migrations")
    if value.startswith("postgresql+psycopg://"):
        return value
    if value.startswith("postgresql://"):
        return value.replace("postgresql://", "postgresql+psycopg://", 1)
    raise RuntimeError("AGENT_DATABASE_URL must use PostgreSQL")


def run_migrations_offline() -> None:
    context.configure(url=database_url(), target_metadata=target_metadata, literal_binds=True, dialect_opts={"paramstyle": "named"}, include_schemas=True, version_table_schema="agent_runtime")
    context.execute("CREATE SCHEMA IF NOT EXISTS agent_runtime")
    with context.begin_transaction():
        context.run_migrations()


def run_sync_migrations(connection: object) -> None:
    context.configure(connection=connection, target_metadata=target_metadata, include_schemas=True, version_table_schema="agent_runtime", compare_type=True)
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    section = config.get_section(config.config_ini_section, {})
    section["sqlalchemy.url"] = database_url()
    engine = async_engine_from_config(section, prefix="sqlalchemy.", poolclass=pool.NullPool)
    async with engine.begin() as connection:
        await connection.execute(text("CREATE SCHEMA IF NOT EXISTS agent_runtime"))
        await connection.run_sync(run_sync_migrations)
    await engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_async_migrations())
