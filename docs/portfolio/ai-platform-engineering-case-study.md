# 실험을 배포 결정으로 연결한 AI Platform Engineering

> 상태: Gateway·CI gate·운영 검증 도구 구현 완료, production SLO 측정 대기

## 문제

모델 실험은 여러 개 있었지만 좋은 결과를 문서에 적는 것만으로는 운영 모델을 통제할 수 없었다. 또한 1 vCPU 서버에서 여러 Agent run이 동시에 provider를 호출하면 비용, latency와 장애 범위가 함께 증가한다.

목표는 모델을 하나 더 붙이는 것이 아니라 다음 질문에 코드로 답하는 것이었다.

- 어떤 모델을 사용할 수 있는가?
- 동시에 몇 건까지 호출할 것인가?
- Provider가 반복 실패하면 어디서 차단하는가?
- 품질이 낮아진 모델이 CI를 통과할 수 있는가?
- 장애 시 prompt와 고객 데이터를 노출하지 않고 원인을 찾을 수 있는가?

## 구현

```text
Client / SDK
→ Spring 인증·workspace RBAC·run quota
→ Agent Safety/Authority Gate
→ private-prompt route evaluator
→ AI Gateway (department generation and ReAct calls)
   ├─ model allowlist
   ├─ bounded concurrency and admission timeout
   ├─ provider/model circuit breaker
   ├─ explicit no-fallback policy
   └─ content-free latency/token/outcome metrics
→ OpenAI or Gemini adapter
→ Spring usage·cost ledger + LangSmith trace
```

모델 후보는 versioned registry에 승인·shadow·signal-only 상태와 허용 용도를 기록한다. Offline report는 release policy가 읽고 accuracy, macro-F1, `HUMAN_REQUIRED` recall, p95와 비용 회귀를 검사한다. Agent CI가 이 명령을 실행하므로 기준을 통과하지 못하면 image build와 production CD로 진행되지 않는다.

## 실험에서 운영 결정까지

| 실험 | 관찰 | 플랫폼 결정 |
|---|---|---|
| LiquidAI A1 vs Luna | A1 p50 `21.7ms`, macro-F1 `0.522`; Luna p50 `2040.5ms`, macro-F1 `0.688` | 빠른 A1을 운영 승격하지 않고 shadow 후보로 유지 |
| BM25+encoder RRF | macro-F1 `0.488`, `HUMAN_REQUIRED` recall `0.20` | local agreement를 자동 실행 근거로 사용하지 않음 |
| Hybrid RAG Top-5 | Recall@5 `0.87`, local accept precision `0.75` | local verifier는 reranking 신호, 최종 허용은 LLM verifier |
| Provider failure injection | 연속 실패 후 circuit open, 다음 호출 차단 | 장애 확산과 retry storm 억제 |

## 의도적으로 하지 않은 것

- 고객 입력이 섞일 수 있는 semantic response cache
- 검증되지 않은 모델로의 자동 fallback
- 1개 VM에서 필요성이 측정되지 않은 Redis·Kubernetes 도입
- 50건 offline set 결과를 실제 운영 SLO 달성으로 표현하는 것

## 검증 가능한 산출물

- Gateway와 장애 주입 테스트: `agent/src/gateway`, `agent/tests/gateway`
- CI release gate: `agent/scripts/evaluation_gate.py`, `agent/evaluation/release-policy.json`
- Python consumer SDK: `sdk/python`
- 부하 시나리오: `infra/load`
- Dashboard: `infra/observability/grafana/ai-platform-overview.json`
- SLO와 장애 대응: `docs/operations/AI_PLATFORM_SLO.md`, `RUNBOOK_AI_GATEWAY.md`

## 현재 한계

Gateway state는 단일 process memory에 있고 운영 실측치는 아직 없다. 다음 단계는 7일 production pilot에서 p95, rejection, provider failure와 실제 run 비용을 수집하고, 단일 instance 한계가 확인될 때만 Redis 기반 분산 admission을 검토하는 것이다.
