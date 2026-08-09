from fastapi.testclient import TestClient

from freelance_ops_agent.main import create_app


def test_health() -> None:
    client = TestClient(create_app())

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "UP", "service": "agent", "version": "0.1.0"}

