import os
import re

from fastapi.testclient import TestClient

from main import create_app
from observability import configure_langsmith_privacy


def test_w3c_trace_context_is_propagated_with_a_new_span() -> None:
    client = TestClient(create_app())
    incoming = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"

    response = client.get("/health", headers={"traceparent": incoming})

    assert response.headers["X-Trace-Id"] == "4bf92f3577b34da6a3ce929d0e0e4736"
    assert response.headers["traceparent"].startswith("00-4bf92f3577b34da6a3ce929d0e0e4736-")
    assert response.headers["traceparent"] != incoming


def test_invalid_trace_context_is_replaced() -> None:
    client = TestClient(create_app())

    response = client.get("/health", headers={"traceparent": "malformed-secret-value"})

    trace_id = response.headers["X-Trace-Id"]
    assert re.fullmatch(r"[0-9a-f]{32}", trace_id)
    assert "malformed" not in response.headers["traceparent"]


def test_langsmith_tracing_always_hides_customer_inputs_and_outputs(monkeypatch) -> None:
    monkeypatch.delenv("LANGSMITH_HIDE_INPUTS", raising=False)
    monkeypatch.delenv("LANGSMITH_HIDE_OUTPUTS", raising=False)

    configure_langsmith_privacy(enabled=True)

    assert os.environ["LANGSMITH_HIDE_INPUTS"] == "true"
    assert os.environ["LANGSMITH_HIDE_OUTPUTS"] == "true"
