# ADR-0028: 신뢰된 실행 계약을 LLM Routing보다 먼저 적용한다

- 상태: Accepted
- 결정일: 2026-08-27
- 보완: [ADR-0015](0015-llm-first-operational-routing.md)
- 부분 대체: [ADR-0027](0027-full-project-analysis-route-floor.md)의 사후 route 상향과 route model call 예산

## Context

ADR-0015는 Safety Gate를 통과한 모든 요청을 LLM evaluator로 분류하도록 결정했다. ADR-0027은
`PROJECT_ANALYSIS` 요청에서 evaluator가 낮은 route를 선택해도 사후 정책으로 `SUPERVISOR`에
상향하도록 보완했다. 구조화된 `direct_tool_operation`도 LLM이 `DIRECT_TOOL`을 선택한 뒤에만
실행됐다.

이 구조에서는 최종 route가 신뢰된 내부 contract로 이미 결정된 요청에도 LLM 호출 비용과
latency가 발생한다. 또한 evaluator 결과를 폐기하고 정책 route를 사용하는데도 route model
call을 budget에 포함한다.

2026-08-27 frozen 50건 replay에서 `DIRECT_TOOL`과 `PROJECT_ANALYSIS` fixture를 LLM 전에
결정적으로 처리했을 때 accuracy `0.760`, Macro-F1 `0.688`은 유지되고 LLM call rate는
100%에서 60%, 저장 응답 기준 비용은 40.6% 감소했다.

같은 실험에서 validation threshold를 적용한 local 자동 routing과 과거 lane agreement는
HUMAN recall과 false automation을 악화시켰으므로 운영 후보에서 제외됐다.

## Decision

운영 routing 순서를 다음과 같이 변경한다.

```text
인증된 Spring 실행 문맥
→ 결정적 Safety/Authority Gate
→ trusted direct_tool_operation이면 DIRECT_TOOL
→ trusted workflow_mode가 PROJECT_ANALYSIS이면 SUPERVISOR
→ 나머지 AD_HOC 요청은 private-prompt LLM evaluator
→ 선택 route 실행
→ write Tool 실행 직전 Spring 권한 재검증
```

- Safety/Authority Gate는 모든 fast path보다 먼저 실행한다.
- `direct_tool_operation`과 `workflow_mode`는 사용자 자연어에서 추론하지 않고 인증된 내부
  request contract만 신뢰한다.
- 현재 허용된 직접 작업은 allowlist에 등록된 enum으로 제한하며 Tool 실행 시 permission을
  다시 검사한다.
- `PROJECT_ANALYSIS`은 Requirements, Research, Deal Design과 Verification 전체 workflow를
  실행한다.
- 결정적 policy route에는 route model call을 청구하지 않는다.
- 프로젝트 전체 분석의 최소 model call budget은 route evaluator 1회를 제외한 부서 실행
  4회로 조정한다.
- 결정 source와 `TRUSTED_DIRECT_TOOL_OPERATION` 또는 `PROJECT_ANALYSIS_FULL_WORKFLOW`
  reason code를 event와 비용 원장에 기록한다.
- AD_HOC 의미 분류에는 ADR-0015의 전 요청 LLM evaluator와 fail-closed 정책을 유지한다.
- BM25, LiquidAI와 TF-IDF 후보는 별도 승격 Gate를 통과하기 전까지 `SHADOW_ONLY` 또는
  `SIGNAL_ONLY`다.

## Consequences

### 장점

- 이미 결정된 제품 workflow에 불필요한 LLM routing 호출을 제거한다.
- 직접 Tool은 model call budget 0으로도 실행 가능하지만 Tool permission과 budget은 계속
  강제된다.
- 프로젝트 분석은 route 분류 결과와 무관하게 전체 부서 workflow를 보장한다.
- 자연어 기반 local router의 false automation 위험을 새 fast path에 도입하지 않는다.

### 비용과 제한

- evaluator가 제안한 대체 route를 프로젝트 분석 trace에 남길 수 없게 된다.
- 실제 비용 절감률은 운영 요청 구성에 따라 달라진다.
- Spring이 잘못된 workflow mode나 direct operation을 전달하면 잘못된 route가 고정될 수
  있으므로 내부 API schema, 인증과 audit가 필수다.
- AD_HOC route의 품질과 LLM tail latency 문제는 그대로 남는다.

## 검증 근거

- [운영 Routing Policy Replay](../testing/routing-operational-policy-replay-2026-08-27.md)
- [Local Router 분포 이동·OOD 평가](../testing/routing-distribution-shift-ood-2026-08-27.md)
- [운영 Shadow Trace 평가 파이프라인](../testing/routing-shadow-trace-pipeline-2026-08-27.md)
- [Shadow Routing 운영 수집·검토 용량 연구](../testing/routing-shadow-collection-capacity-2026-08-27.md)
- `experiments/routing_benchmark/reports/2026-08-27-operational-replay/`
- `experiments/routing_benchmark/reports/2026-08-27-distribution-shift/`
- `experiments/routing_benchmark/reports/2026-08-27-shadow-pipeline-smoke/`
- `experiments/routing_benchmark/reports/2026-08-27-shadow-collection-plan/`
