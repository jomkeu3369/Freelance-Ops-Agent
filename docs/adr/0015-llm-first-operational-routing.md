# ADR-0015: 운영 라우팅은 정책 Gate와 전 요청 LLM 평가를 사용한다

- 상태: Accepted
- 결정일: 2026-08-13
- 대체: [ADR-0012](0012-hybrid-agent-routing-gateway.md)의 local-first hybrid cascade

## Context

ADR-0012는 BM25와 fine-tuned encoder를 RRF로 결합하고, 두 lane이 불일치하는 경계 요청만 LLM evaluator로 보내 비용을 줄이도록 결정했다. 이후 사람이 검토한 균형 frozen test 50건에서 실제 A1 checkpoint를 포함한 구성을 평가했다.

- BM25: accuracy `0.660`, macro-F1 `0.601`
- LiquidAI A1 encoder: accuracy `0.360`, macro-F1 `0.339`
- RRF: accuracy `0.540`, macro-F1 `0.488`
- RRF `REACT_AGENT` F1: `0.000`
- RRF `HUMAN_REQUIRED` recall: `0.200`
- lane agreement gate: coverage `0.42`, accepted accuracy `0.8095`

평균 accepted accuracy와 달리 실제 `HUMAN_REQUIRED` 요청 중 두 lane이 같은 비안전 route에 동의한 사례가 있었다. 따라서 lane agreement는 자동 실행을 허용할 충분조건이 아니며, local-first cascade는 V2 초기 운영의 안전 기준을 충족하지 못한다.

## Decision

V2 초기 운영 라우팅은 다음 순서를 사용한다.

```text
인증된 Spring 실행 문맥
→ 결정적 Safety/Authority Gate
→ 모든 통과 요청에 private-prompt LLM route evaluator
→ 선택된 실행 route
→ write Tool 실행 직전 Spring 권한 재검증
```

- Safety/Authority Gate의 입력은 사용자 문장에서 추론하지 않는다. Spring이 인증된 실행 문맥으로 제공하는 side effect, 민감정보, 재무·법적 권한, 비가역성, 승인 필요 여부와 권한 검증 결과만 사용한다.
- 승인 필요, 비가역 작업, 민감정보 외부 전송 또는 필요한 권한 미검증은 LLM 호출 전에 `HUMAN_REQUIRED`로 종료한다.
- Gate를 통과한 모든 요청은 로컬 모델의 confidence 또는 lane agreement와 관계없이 LLM evaluator가 분류한다.
- evaluator는 one-shot, tool-free, `store=false`, strict structured output으로 실행한다. private system prompt는 secret manager에서 주입하고 승인된 version 및 SHA-256과 일치해야 한다.
- evaluator 오류, timeout, schema 실패, prompt manipulation 탐지 또는 abstain은 `HUMAN_REQUIRED`로 fail-closed한다.
- BM25·encoder·RRF 결과는 evaluator 입력으로 보내지 않는다. 모델 편향을 피하고 독립 비교가 가능하도록 optional shadow trace로만 기록한다.
- shadow mode는 기본 비활성화한다. 명시적으로 활성화한 환경에서만 추론하며 운영 route를 변경할 수 없다.
- `BoundaryAwareRouteGateway` local-first cascade는 과거 benchmark 재현용으로만 보존하고 운영 wiring에서 사용하지 않는다.
- 브라우저는 SafetyContext를 신뢰 경계로 전달할 수 없다. Spring이 workspace 권한과 resource 상태를 검증해 내부 Agent 요청에 포함한다.

## 향후 local router 승격 조건

실제 업무 요청과 사람 수정 결과를 shadow mode로 축적한 뒤 별도 ADR로 재검토한다. 최소 조건은 다음과 같다.

- 사용자·workspace·project 단위 group-aware split과 untouched test
- route별 F1 최소 `0.70`
- `HUMAN_REQUIRED` recall 최소 `0.95`
- false automation 상한 사전 정의 및 충족
- route별 calibration과 drift 검증
- LLM 대비 비용 또는 latency 개선이 통계적으로 의미 있음
- shadow 기간에 권한·안전 회귀가 없음

표본 수만 충족하거나 전체 accuracy만 개선되는 것은 승격 근거가 아니다.

## Consequences

초기 운영의 LLM 비용과 latency는 hybrid cascade보다 증가한다. 대신 현재 검증되지 않은 로컬 분류기가 자동 실행 경로를 선택하는 위험을 제거한다. shadow 결과와 LLM 결정 및 사람 수정 결과를 함께 축적하면 향후 저위험 route부터 제한적으로 자동 확정하는 근거를 만들 수 있다.

평가 근거는 [Hybrid Router 단독 평가](../testing/hybrid-router-standalone-evaluation.md)에 기록한다.
