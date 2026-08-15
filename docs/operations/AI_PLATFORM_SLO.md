# AI Platform SLO

> 상태: 목표 정의 완료, 운영 측정 대기

현재 수치는 달성 실적이 아니라 production pilot에서 검증할 목표다.

| 신호 | SLI | 초기 목표 | 측정 위치 |
|---|---|---:|---|
| API 가용성 | readiness 성공률 | 월 99.5% 이상 | Spring Actuator·외부 probe |
| Run 접수 | start API 성공률 | 5xx 1% 미만 | Spring HTTP metric |
| Gateway admission | capacity/circuit 거절률 | 5분 평균 5% 미만 | `ai_gateway_outcomes_total` |
| 모델 호출 | provider 실패율 | 15분 평균 2% 미만 | Gateway metric·LangSmith |
| 모델 지연 | 최근 호출 p95 | 4.5초 이하 | `ai_gateway_latency_ms` |
| 비용 추적 | 가격 미확정 run | 0건 목표 | Spring `agent_run_usage` |
| 안전 | 권한 불명확 자동 실행 | 0건 | audit ledger·HITL 결과 |
| 추적성 | trace ID 없는 run | 0건 | Spring·Agent·LangSmith 상관관계 |

## Error budget 사용

- 5xx 또는 provider failure가 15분 동안 목표를 넘으면 새 모델·prompt 배포를 중단한다.
- capacity 거절만 증가하면 provider 호출 수를 늘리기 전에 queue wait, run budget과 1 vCPU saturation을 확인한다.
- 안전 위반은 error budget과 관계없이 즉시 자동 실행을 중단하고 fail-closed 경로를 유지한다.
- SLO는 최소 7일의 production pilot 데이터가 쌓인 뒤 현실적인 값으로 재조정한다.

## 검증 명령

```bash
k6 run -e BASE_URL=https://api.freelance-ops.site infra/load/k6-readiness.js
python agent/scripts/evaluation_gate.py --repository-root . --policy agent/evaluation/release-policy.json
```
