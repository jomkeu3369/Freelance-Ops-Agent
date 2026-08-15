from api.platform.router import _prometheus
from gateway import GatewayMetricSnapshot


def test_gateway_metrics_render_without_prompt_or_response_content() -> None:
    snapshot = GatewayMetricSnapshot(
        total_calls=3,
        successful_calls=1,
        failed_calls=1,
        rejected_calls=1,
        inflight_calls=0,
        input_tokens=120,
        output_tokens=30,
        latency_ms_p50=100.0,
        latency_ms_p95=400.0,
        outcomes={"SUCCESS": 1, "CIRCUIT_OPEN": 1, "PROVIDER_FAILURE": 1}
    )

    rendered = _prometheus(snapshot)

    assert 'ai_gateway_calls_total{outcome="success"} 1' in rendered
    assert 'ai_gateway_outcomes_total{code="CIRCUIT_OPEN"} 1' in rendered
    assert "prompt" not in rendered.lower()
    assert "response" not in rendered.lower()
