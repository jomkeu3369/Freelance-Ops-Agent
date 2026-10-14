"""Opt-in localhost peer for the Java HTTP contract test; executor and signing are test fixtures."""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import runpy
from pathlib import Path
from uuid import uuid4

import uvicorn

from infrastructure.database import PgVectorConnectionManager, PgVectorPoolConfig
from runtime import PostgresAgentRunStore, RunCoordinator


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--fixture-output", type=Path, required=True)
    args = parser.parse_args()
    database_url = os.environ["AGENT_INTEGRATION_DATABASE_URL"]
    fixtures = runpy.run_path(str(Path(__file__).parents[1] / "api" / "test_agent_runs.py"))
    request = fixtures["_request"](uuid4(), uuid4(), uuid4(), uuid4())
    request.budget.max_duration_seconds = 180
    # Use the existing ephemeral, test-only authentication setup. Never load operational keys.
    test_client, token = fixtures["_client_and_token"](
        request, fixtures["InterruptThenCompleteExecutor"](), token_ttl_seconds=60,
    )
    database = PgVectorConnectionManager(PgVectorPoolConfig(database_url=database_url))
    store = PostgresAgentRunStore(database)
    app = test_client.app
    app.state.run_coordinator = RunCoordinator(store, fixtures["InterruptThenCompleteExecutor"]())
    app.state.database_manager = database
    app.state.postgres_run_store = store
    # The temporary fixture is consumed by the Java test, never logged or committed.
    args.fixture_output.parent.mkdir(parents=True, exist_ok=True)
    args.fixture_output.write_text(json.dumps({
        "request": request.model_dump(mode="json", by_alias=True, exclude={"clarification_history"}),
        "token": token,
    }, ensure_ascii=False), encoding="utf-8")
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=args.port, log_level="warning"))
    # Psycopg async requires a selector loop on Windows. Linux already uses it.
    asyncio.run(server.serve(), loop_factory=asyncio.SelectorEventLoop)


if __name__ == "__main__":
    main()
