import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

from fastapi.testclient import TestClient

from infrastructure.readiness import DatabaseReadinessProbe
from main import create_app


def test_health() -> None:
    client = TestClient(create_app())

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "UP", "service": "agent", "version": "0.1.0"}


def test_readiness_requires_completed_lifespan() -> None:
    app = create_app()
    client = TestClient(app)
    assert client.get("/health/readiness").status_code == 503
    with client:
        assert client.get("/health/readiness").json()["status"] == "UP"
    assert client.get("/health/readiness").status_code == 503
    assert client.get("/health").status_code == 200


def test_readiness_detects_database_failure_without_exposing_details_and_recovers() -> None:
    app = create_app()
    probe = AsyncMock(side_effect=[RuntimeError("private connection credentials"), None])
    with TestClient(app) as client:
        app.state.database_manager = SimpleNamespace(health=probe)
        failed = client.get("/health/readiness")
        assert failed.status_code == 503
        assert failed.json() == {"status": "DOWN", "service": "agent", "version": "0.1.0"}
        assert client.get("/health").status_code == 200
        assert client.get("/health/readiness").status_code == 200
    assert probe.await_count == 2


def test_readiness_times_out_stalled_database_probe() -> None:
    async def stalled_probe() -> None:
        await asyncio.sleep(30)

    app = create_app()
    with TestClient(app) as client:
        app.state.database_manager = SimpleNamespace(health=stalled_probe)
        assert client.get("/health/readiness").status_code == 503
        assert client.get("/health").status_code == 200


def test_readiness_requires_open_configured_checkpointer() -> None:
    app = create_app()
    with TestClient(app) as client:
        checkpoint = SimpleNamespace(is_open=False)
        app.state.checkpoint_journal = checkpoint
        assert client.get("/health/readiness").status_code == 503
        checkpoint.is_open = True
        assert client.get("/health/readiness").status_code == 200


async def test_readiness_bounds_wait_without_driver_cancellation_and_coalesces_requests() -> None:
    release = asyncio.Event()
    calls = 0
    cancelled = False

    async def blocked_probe() -> None:
        nonlocal calls, cancelled
        calls += 1
        try:
            await release.wait()
        except asyncio.CancelledError:
            cancelled = True
            await release.wait()

    database = SimpleNamespace(health=blocked_probe)
    probe = DatabaseReadinessProbe(timeout_seconds=0.02)
    try:
        results = await asyncio.wait_for(asyncio.gather(*(probe.check(database) for _ in range(20))), timeout=1)
        assert results == [False] * 20
        assert await probe.check(database) is False
        assert calls == 1
        assert cancelled is False
        release.set()
        await asyncio.sleep(0)
        assert await probe.check(database) is True
        assert calls == 2
    finally:
        release.set()
        await probe.close()
