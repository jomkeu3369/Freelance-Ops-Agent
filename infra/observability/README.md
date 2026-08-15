# AI Platform 관측 구성

Agent의 `/internal/v1/platform/metrics`는 prompt와 결과 원문 없이 Gateway 호출·거절·실패·동시 실행·token·최근 latency를 Prometheus 형식으로 제공한다.

- `AGENT_GATEWAY_METRICS_ENABLED=true`
- `AGENT_GATEWAY_METRICS_BEARER_TOKEN=<32바이트 이상 난수>`
- Scraper는 Docker internal network에서 `Authorization: Bearer <token>`으로 접근한다.
- Caddy에는 이 endpoint를 공개하는 route를 추가하지 않는다.

[`grafana/ai-platform-overview.json`](grafana/ai-platform-overview.json)은 Prometheus datasource를 연결한 뒤 import하는 dashboard다. 실행별 업무 비용은 Spring의 `agent_run_usage`, 호출 trace는 LangSmith에서 확인하며 세 체계에 같은 trace ID를 사용한다.
