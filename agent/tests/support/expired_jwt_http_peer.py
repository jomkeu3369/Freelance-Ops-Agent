"""Real OperationalAgentExecutor with a slow local provider fixture and actual Spring tool HTTP."""

from __future__ import annotations

import argparse
import asyncio
import json
import os
from datetime import UTC, datetime, timedelta
from pathlib import Path

import uvicorn

from contracts import AgentRunRequest
from infrastructure.database import PgVectorConnectionManager, PgVectorPoolConfig
from integrations.spring_tools import SpringToolClient
from main import create_app
from providers import ModelGeneration
from runtime import FailClosedOperationalGateway, OperationalAgentExecutor, PostgresAgentRunStore, RunCoordinator
from security import DelegationTokenVerifier


class SlowProviderFixture:
    def __init__(self, expires_at: datetime) -> None:
        self._after_expiry = expires_at + timedelta(seconds=8)

    async def generate_react_step(self, selection, prompt, *, max_output_tokens, max_attempts=None):
        del selection, max_output_tokens, max_attempts
        step = json.loads(prompt)
        department = step["objective"]["department"]
        if department == "REQUIREMENTS" and step["observations"]:
            payload = {"action": "FINAL", "summary": "Validated work saved before expiry", "arguments": {}}
        else:
            if department != "REQUIREMENTS":
                # Real wall time, without clock patches, expiry allowance or token renewal.
                while (remaining := (self._after_expiry - datetime.now(UTC)).total_seconds()) > 0:
                    await asyncio.sleep(min(remaining, 5))
            payload = {"action": "TOOL", "tool_name": "get_project_context", "arguments": {}}
        return ModelGeneration(payload=payload, input_tokens=5, output_tokens=5)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fixture-file", type=Path, required=True)
    parser.add_argument("--port", type=int, required=True)
    args = parser.parse_args()
    fixture = json.loads(args.fixture_file.read_text(encoding="utf-8"))
    request = AgentRunRequest.model_validate(fixture["request"])
    provider = SlowProviderFixture(datetime.fromisoformat(fixture["expiresAt"].replace("Z", "+00:00")))
    executor = OperationalAgentExecutor(
        FailClosedOperationalGateway(), provider, SpringToolClient(fixture["toolBaseUrl"])
    )
    database = PgVectorConnectionManager(PgVectorPoolConfig(database_url=os.environ["AGENT_INTEGRATION_DATABASE_URL"]))
    store = PostgresAgentRunStore(database)
    public_key = f"-----BEGIN PUBLIC KEY-----\n{fixture['publicKey']}\n-----END PUBLIC KEY-----"
    app = create_app(
        run_coordinator=RunCoordinator(store, executor),
        delegation_token_verifier=DelegationTokenVerifier(
            public_key=public_key, key_id="long-run-test", issuer="long-run-backend", audience="freelance-ops-agent"
        ),
    )
    app.state.database_manager = database
    app.state.postgres_run_store = store
    # The request is supplied only by the Java caller; startup does not execute it.
    assert request.budget.max_duration_seconds == 180
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=args.port, log_level="warning"))
    asyncio.run(server.serve(), loop_factory=asyncio.SelectorEventLoop)


if __name__ == "__main__":
    main()
