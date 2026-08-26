# Routing·Orchestration·Scheduler 책임 경계

> 작성일: 2026-08-26  
> 상태: 기존 Accepted ADR과 Runtime 인수인계 문서를 설명하는 보조 문서  
> 기준 문서: `2026-08-25-deep-agent-async-runtime-handoff.md`

## 1. 결론

Deep Agents 비동기 Runtime 설계는 현재 구조 전체를 Scheduler로 대체하는 방안이 아니다.
Routing, Global Orchestration과 Scheduler는 서로 다른 결정을 담당하며 목표 구조에서도 함께
유지된다.

```text
인증된 요청
→ Safety/Authority Gate
→ 실행 Route 결정
→ Global Orchestrator의 부서·의존성 결정
→ DepartmentTask 생성
→ Runtime 예측
→ Queue와 Scheduler/Dispatcher
→ Department Deep Agent 또는 Async Specialist 실행
→ 독립 Verification
→ 결과 또는 HITL
```

따라서 변경 방향은 다음과 같이 요약한다.

```text
Routing 제거              X
Global Orchestrator 제거  X
Scheduler가 모델을 선택   X

기존 실행부의 비동기화    O
장시간 작업의 queue화     O
실행 순서와 worker 배정   O
상태 조회·지시·취소 지원  O
```

## 2. 각 계층이 답하는 질문

| 계층 | 담당하는 질문 | 대표 출력 |
|---|---|---|
| Safety/Authority Gate | 이 요청을 자동으로 실행해도 되는가? | 통과 또는 `HUMAN_REQUIRED` |
| Routing Gateway | 어떤 실행 형태로 처리해야 하는가? | `DIRECT_TOOL`, `SIMPLE_LLM`, `REACT_AGENT`, `SUPERVISOR`, `HUMAN_REQUIRED` |
| Global Orchestrator | 어떤 부서가 어떤 순서와 의존관계로 수행해야 하는가? | 부서 선택, 상태 전이, `DepartmentTask` |
| Runtime Predictor | 이 leaf task의 실제 실행시간은 어느 정도인가? | `predicted_service_runtime_seconds` |
| Scheduler/Dispatcher | 준비된 작업을 언제, 어떤 순서로, 어느 worker에 배정할 것인가? | dispatch와 admission 결정 |
| Department Deep Agent | 부서 내부 목표를 어떻게 분해하고 수행할 것인가? | 전문 작업 계획과 `DepartmentResult` |
| Verification | 결과가 근거·계산·권한·schema 조건을 충족하는가? | 승인, 보완 또는 HITL |

Routing은 요청의 의미와 위험을 바탕으로 **실행 경로**를 선택한다. Scheduler는 Routing과
Orchestration을 거쳐 생성된 실행 가능한 작업들의 **실행 시점과 순서**를 결정한다. 두 계층은
입력과 출력이 다르므로 서로 대체할 수 없다.

## 3. 현재 Routing의 의미

현재 운영 Routing은 단순히 여러 모델 중 하나를 고르는 model router가 아니다. 주된 책임은
요청을 다음 실행 route 중 하나로 분류하는 것이다.

- `DIRECT_TOOL`: 구조화된 직접 Tool 작업
- `SIMPLE_LLM`: 단일 모델 중심의 단순 처리
- `REACT_AGENT`: Tool을 사용하는 bounded ReAct 실행
- `SUPERVISOR`: 여러 부서가 참여하는 orchestration
- `HUMAN_REQUIRED`: 자동 실행을 중단하고 사람의 판단 요청

ADR-0015에 따라 V2 초기 운영에서는 인증된 Spring 실행 문맥에 대한 결정적
Safety/Authority Gate를 먼저 적용하고, Gate를 통과한 요청은 LLM route evaluator가
분류한다. 기존 BM25·encoder·RRF local-first cascade는 운영 route를 결정하지 않으며,
명시적으로 활성화한 경우에만 shadow 진단 자료를 만든다.

실행에 사용할 모델은 route 자체와 동일한 개념이 아니다. 모델은 요청의
`model_selection`, 부서 프로필 또는 사전 등록된 Specialist 프로필을 통해 별도로 지정하고
기록한다. 조용한 자동 model fallback은 목표 구조에 포함하지 않는다.

## 4. Scheduler가 추가되는 위치

Scheduler는 Global Orchestrator가 `DepartmentTask` 또는 leaf Specialist task를 만든 뒤에
동작한다.

```text
Global Orchestrator
  └─ DepartmentTask 생성
       └─ Runtime Predictor
            └─ Ready/Priority Queue
                 └─ Scheduler/Dispatcher
                      └─ Worker와 Async Specialist
```

Scheduler가 고려할 수 있는 값은 다음과 같다.

- task dependency와 ready 여부
- workspace 간 fairness
- 사용자 또는 업무 priority
- `predicted_service_runtime_seconds`
- task age와 maximum wait
- worker capacity
- 중앙 budget과 admission 조건
- cancel 또는 redirect 상태

Scheduler는 요청의 업무 의미를 다시 분류하거나 권한을 완화하지 않는다. 또한 예측 시간이
짧다는 이유로 Safety Gate, dependency, budget 또는 HITL을 우회할 수 없다.

## 5. 무엇이 변경되는가

목표 구조에서 주로 변경되는 대상은 현재 실행부다.

| 현재 또는 초기 scaffold | 목표 구조 |
|---|---|
| 요청 처리 흐름 안에서 부서 작업을 직접 실행 | 독립적인 `DepartmentTask`와 `TaskAttempt` 생성 |
| 정적인 부서 순차 실행 | dependency-aware ready queue와 dispatch |
| 장시간 작업 완료까지 하나의 실행 흐름이 대기 | stateful Async Specialist가 독립 thread에서 실행 |
| 실행 중 세부 task 제어가 제한적 | status, soft update, hard redirect, cancel 제공 |
| 실행 결과를 현재 호출에 바로 병합 | revision과 attempt를 검사한 뒤 late result를 거부하고 병합 |
| 실행시간 예측이 dispatch에 관여하지 않음 | 예측시간을 fairness와 aging이 제한하는 scheduling 신호로 사용 |

반대로 다음 경계는 유지된다.

- Spring Boot의 인증, workspace RBAC와 business transaction
- Safety/Authority Gate와 실행 Routing
- LangGraph Global Orchestrator의 부서 선택, dependency, budget과 HITL
- Department별 Tool·모델·Specialist allowlist
- Verification workflow의 독립 승인
- PostgreSQL checkpoint, Task Registry와 audit의 권위

Deep Agents도 Global Orchestrator를 대체하지 않는다. Requirements, Research와 Deal Design
부서 내부에서 planning, context 관리와 등록된 Specialist 실행을 담당한다.

## 6. Runtime Predictor와 Scheduler의 제한

Runtime Predictor는 leaf task의 service runtime을 예측한다.

```text
queue_wait_seconds
= started_at - queued_at

service_runtime_seconds
= completed_at - started_at
```

Scheduler는 `predicted_service_runtime_seconds`를 사용할 수 있지만 이 값만으로 운영 정책을
결정하지 않는다. 짧은 작업을 우선하는 Predicted-SJF는 평균 대기시간을 줄일 수 있지만 긴
작업을 굶길 수 있으므로 fairness, bounded aging, overdue lane과 admission control이 함께
필요하다.

Cache hit 작업은 worker를 점유하지 않으므로 일반 service runtime 학습 표본에서 제외한다.
Hard redirect는 같은 `task_id`를 유지하더라도 새 revision과 attempt를 만들고 실행시간을 다시
예측한다.

## 7. 현재 구현 상태와 단계적 전환

현재 `agent/src/runtime/executor.py`는 운영 route를 먼저 결정한 뒤 route에 맞는 Tool, ReAct
또는 부서 실행을 수행한다. `agent/src/graph/supervisor.py`는 정적인 부서 순차 실행
scaffold다.

2026-08-26 기준 Scheduler 관련 코드는 운영 queue가 아니라 효용성을 평가하기 위한
simulation prototype이다. 인수인계 문서도 전체 Scheduler 구현을 사용자 승인 전까지
시작하지 않도록 명시한다.

권장 전환 순서는 다음과 같다.

1. `DepartmentTask`, `TaskAttempt`, `TaskCommand`, `TaskEvent` contract를 확정한다.
2. Async Task adapter와 PostgreSQL Task Registry를 구축한다.
3. Harness Action Gateway와 중앙 permission·budget guard를 연결한다.
4. Research의 read-only Async Specialist 한 종류로 vertical slice를 검증한다.
5. 상태 조회, soft update, hard redirect와 cancel을 추가한다.
6. 실제 실행 이력을 확보한 뒤 Runtime Predictor를 Dispatcher admission에 연결한다.

이 과정은 한 번에 현재 runtime을 제거하는 전면 교체가 아니라, 기존 정책 경계를 유지하면서
실행부를 작은 단위로 비동기화하는 단계적 전환이다.

## 8. 오해하기 쉬운 표현

### “Scheduler가 적절한 모델로 보낸다”

정확하지 않다. Scheduler는 등록된 실행 대상과 worker 중에서 작업의 실행 순서를 정한다.
모델 선택은 요청의 model selection과 사전 등록된 부서·Specialist profile의 정책에 따른다.

### “Deep Agents가 전체 시스템을 orchestrate한다”

정확하지 않다. Deep Agents는 부서 내부 실행 하네스다. 부서 간 상태 전이와 중앙 정책은
LangGraph Global Orchestrator가 소유한다.

### “비동기 전환 후 Routing은 필요 없다”

정확하지 않다. 직접 Tool로 끝낼 요청, 단일 LLM이면 충분한 요청, 다부서 실행이 필요한 요청과
사람 승인이 필요한 요청을 구분해야 불필요한 queue와 Agent 실행을 막을 수 있다.

### “현재 Scheduler prototype을 운영에 바로 연결한다”

정확하지 않다. 현재 결과는 정책 효용성 simulation이며 운영 queue, 장애 복구, 동시성 제어,
분산 lock, idempotency와 실제 SLO 검증을 대신하지 않는다.

## 9. 관련 문서

- `docs/handoffs/2026-08-25-deep-agent-async-runtime-handoff.md`
- `docs/architecture/deep-agents-target-architecture.md`
- `docs/adr/0013-deep-agents-department-runtime.md`
- `docs/adr/0015-llm-first-operational-routing.md`
- `docs/adr/0026-policy-controlled-ai-gateway.md`
- `agent/src/runtime/executor.py`
- `agent/src/graph/supervisor.py`
