#!/usr/bin/env bash
set -euo pipefail
[[ "$1" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]
mapfile -t agents < <(docker ps -q --filter label=com.docker.compose.service=agent)
[[ "${#agents[@]}" == 1 ]]
docker exec -i -e "DIAGNOSTIC_RUN_ID=$1" -e PYTHONDONTWRITEBYTECODE=1 \
  -e PYTHONPATH=/app/src \
  -e LANGSMITH_TRACING=false -e LANGSMITH_TRACING_V2=false \
  "${agents[0]}" /app/.venv/bin/python - <<'PY'
import asyncio
import json
import os
from uuid import UUID

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from config import get_settings
from infrastructure.database import PgVectorConnectionManager
from infrastructure.database.models import AgentRunEventModel, AgentRunStateModel
from runtime.postgres_store import PostgresAgentRunStore


async def main():
    run_id = UUID(os.environ["DIAGNOSTIC_RUN_ID"])
    engine = create_async_engine(PgVectorConnectionManager._sqlalchemy_url(get_settings().database_url),
        connect_args={"options": "-c default_transaction_read_only=on -c search_path=agent_runtime,public"})
    try:
        async with AsyncSession(engine, autoflush=False) as session:
            model = await session.get(AgentRunStateModel, run_id)
            if model is None:
                print(json.dumps({"runId": str(run_id), "found": False}))
                return
            report = {"runId": str(run_id), "status": model.status, "errorCode": model.error_code}
            try:
                view = PostgresAgentRunStore._view(model)
                report["viewContract"] = "VALID"
                report["messages"] = len(view.result.pet_messages) if view.result else 0
                report["usageKnown"] = all(call.usage_known for call in view.usage.provider_calls) if view.usage else None
                report["usageReservationMatches"] = view.usage.platform_reservation_id == run_id if view.usage else None
                report["closed"] = view.usage.execution_closed if view.usage else None
            except ValidationError as error:
                report["viewContract"] = [{"field": list(item["loc"]), "type": item["type"]}
                    for item in error.errors(include_input=False, include_context=False, include_url=False)]
            events = await session.scalars(select(AgentRunEventModel.type)
                .where(AgentRunEventModel.run_id == run_id).order_by(AgentRunEventModel.event_id.desc()).limit(8))
            report["lastEventTypes"] = list(events)
            print(json.dumps(report, ensure_ascii=False))
    finally:
        await engine.dispose()


asyncio.run(main())
PY
