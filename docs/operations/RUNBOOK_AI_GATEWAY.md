# AI Gateway 장애 대응 Runbook

## 1. 증상 분류

| 증상 | 대표 signal | 먼저 확인할 항목 |
|---|---|---|
| 요청 급증 | `GATEWAY_CAPACITY_EXCEEDED` | inflight, Spring rate limit, CPU |
| Provider 장애 | `PROVIDER_FAILURE`·`CIRCUIT_OPEN` | Provider status, 429/5xx, quota |
| 모델 정책 오류 | `MODEL_NOT_ALLOWED` | 배포 allowlist와 Spring model selection |
| 비용 급증 | token 증가·모델 호출 수 증가 | run budget, clarification loop, retry |
| 지연 증가 | p95 4.5초 초과 | provider latency, network, 동시 실행 |

## 2. 즉시 조치

1. 새 배포와 모델·prompt 변경을 중단한다.
2. trace ID 하나를 기준으로 Spring run, Agent log와 LangSmith metadata를 대조한다.
3. prompt·token·credential 원문을 로그나 이슈에 붙이지 않는다.
4. Provider 장애라면 자동 fallback을 켜지 않는다. 실행은 안정된 기존 모델 또는 fail-closed 결과를 유지한다.
5. 과부하면 Spring의 Agent rate limit을 낮추고 유료 smoke·batch 작업을 중지한다.
6. 최근 배포 직후 시작됐다면 서비스별 marker로 해당 Agent image만 rollback한다.

## 3. 진단 명령

```bash
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'
docker logs --since 20m --timestamps freelance-ops-v2-production-agent-1
curl -H "Authorization: Bearer $AGENT_METRICS_TOKEN" http://agent:8000/internal/v1/platform/metrics
```

Metrics token을 shell history에 직접 입력하지 않고 일시적인 환경 변수나 secret file에서 주입한다.

## 4. 복구 확인

- Agent `/health`와 Spring readiness가 모두 정상이다.
- 15분 동안 provider failure와 capacity rejection이 SLO 아래다.
- 1회 opt-in Agent smoke가 접수되고 terminal 상태에 도달한다.
- Spring usage ledger에 provider/model/token/cost status가 기록된다.
- incident의 최초 감지, 영향 범위, 원인, 완화, 재발 방지와 검증 결과를 남긴다.

## 5. 금지 사항

- 장애 중 임의 모델로 조용히 fallback하지 않는다.
- quota와 circuit breaker를 동시에 해제하지 않는다.
- production prompt, API key, JWT 또는 고객 입력을 공유 문서에 복사하지 않는다.
- 데이터베이스나 volume을 복구 근거 없이 삭제하지 않는다.
