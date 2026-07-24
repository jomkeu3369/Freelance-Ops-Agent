# 멀티 에이전트 Supervisor 아키텍처 검토

> 검토일: 2026-07-24
> 대상: `docs/V2_SPECIFICATION.md`, ADR-0001부터 ADR-0007, 현재 V1 코드와 `test/` 실험 파일
> 결론: 조건부 승인 — 방향은 적절하나 V2 scaffold 전에 실행 계약과 실패 의미를 보완해야 한다.

## 1. 검토 요약

제한된 계층형 Supervisor를 목표 구조로 선택하고 단일 Agent를 baseline으로 유지한 결정은 제품의 재현성, 권한 통제와 비용 제한에 부합한다. 특히 다음 결정은 유지할 가치가 있다.

- 자유로운 swarm 대신 코드로 고정된 조직도와 transition을 사용한다.
- `Global Orchestrator → Department Supervisor → Specialist/Tool` 경계를 넘지 않는다.
- 단순 요청은 Agent를 거치지 않고 `DIRECT_TOOL`로 처리한다.
- 부문별 최소 Tool만 허용하고 Spring의 delegation token과 permission 검사를 우회하지 않는다.
- 금액과 일정 계산은 결정적 Java Tool 결과를 권위 있는 값으로 취급한다.
- 직군·국가 확장을 Agent 복제가 아니라 versioned pack으로 처리한다.
- 계층형 구조는 단일 Agent baseline보다 품질·비용이 개선된 부문에만 적용한다.

현재 명세는 목표와 금지 사항은 명확하지만 병렬 실행, 상태 병합, 예산 집행과 실패 복구의 구현 계약은 아직 충분히 결정적이지 않다. 아래 필수 보완을 마친 뒤 scaffold를 시작하는 것이 안전하다.

## 2. 필수 보완 사항

### P0. 노출된 로컬 자격 증명 폐기

`test/.env`에 실제 형식의 OpenAI 및 LangSmith 자격 증명이 평문으로 존재한다. 이 파일은 현재 `.gitignore`에 의해 Git 추적 대상은 아니지만 이미 노출된 자격 증명으로 간주해야 한다.

필수 조치:

1. OpenAI와 LangSmith에서 해당 키를 즉시 폐기하고 새 키를 발급한다.
2. 새 키는 저장소 밖의 안전한 환경 변수 또는 secret store로 관리한다.
3. `test/.env.example`이 필요하면 값 없이 변수 이름만 기록한다.
4. 두 Codex 환경과 shell history, IDE run configuration에 기존 키가 남아 있는지 확인한다.
5. Git history와 원격 branch에 secret이 포함되지 않았는지 별도 secret scan을 실행한다.

실제 키 값은 문서와 로그에 복사하지 않는다.

### P0. 신뢰 경계와 Agent 상태 분리

현재 공통 상태에는 `workspace_id`, `initiated_by`, `delegated_permissions`와 업무 결과가 함께 나열되어 있다. 식별자와 권한은 모델이나 Specialist가 수정할 수 있는 일반 graph state로 취급하면 안 된다.

다음 두 영역을 분리해야 한다.

```text
TrustedRunContext
run_id, thread_id, trace_id
workspace_id, initiated_by
delegation_token_reference, effective_permissions
provider_policy, budget_policy, schema_versions

WorkflowState
objective, request_tier
requirements, assumptions, evidence, risks
department_results, validation_results, pending_questions
quote_draft, approval_required, status
```

- `TrustedRunContext`는 Spring 요청과 검증된 delegation token에서 생성하며 Agent가 수정할 수 없게 한다.
- Specialist와 Tool wrapper에는 필요한 최소 field만 읽기 전용으로 전달한다.
- Spring Tool API는 Python state의 permission 표현이 아니라 서명된 token과 현재 membership을 권위 있는 값으로 사용한다.
- checkpoint 복원 시 context와 token의 workspace, run binding, 만료와 schema version을 다시 검증한다.

### P0. 부문 작업과 결과의 versioned contract

자연어 message history를 부문 간 contract로 사용하지 말고 최소한 다음 envelope를 먼저 정의해야 한다.

```text
DepartmentTask
task_id, run_id, department, objective
input_reference_ids, allowed_tool_ids
input_schema_version, result_schema_version
budget_slice, deadline

DepartmentResult
task_id, department, status
findings, evidence_ids, assumptions
unresolved_questions, risks, validation_status
usage, error
```

- 모든 결과는 `task_id`로 deduplicate할 수 있어야 한다.
- evidence 전문보다 불변 ID와 version을 전달한다.
- 계산 결과와 검증 결과에는 생성 주체와 authoritative 여부를 표시한다.
- schema 불일치는 재시도 가능한 모델 오류와 재시도 불가능한 contract 오류로 구분한다.

### P0. 병렬 실행과 결과 병합 규칙

독립적인 조사를 병렬화하려면 reducer와 충돌 규칙을 LLM prompt가 아니라 코드 계약으로 정해야 한다.

- 병렬 node가 수정할 수 있는 state field를 분리한다.
- list append는 stable task order 또는 명시적 sort key로 정규화한다.
- 동일 evidence와 assumption은 stable ID로 deduplicate한다.
- 법률 근거, 관할권, 기준일 또는 계산 결과가 충돌하면 Global Orchestrator가 임의로 재작성하지 않는다.
- 충돌은 `CONFLICT` validation result로 만들고 Verification 또는 HITL로 보낸다.
- 일부 부문 실패 시 전체 실패, 부분 결과 허용 또는 재시도 중 어떤 정책을 적용할지 request tier별로 정의한다.
- 취소와 timeout은 실행 중인 하위 task에 전파하고 늦게 도착한 결과는 현재 run revision에 반영하지 않는다.

### P0. 중앙 예산 집행

`max_model_calls`, `max_tool_calls`, token, 검색 credit와 실행 시간은 state에 숫자만 저장해서는 강제되지 않는다. 모든 provider와 Tool 호출이 통과하는 중앙 budget guard가 필요하다.

- 병렬 호출 전 예약하고 완료 또는 취소 후 실제 사용량으로 정산한다.
- counter 갱신은 원자적으로 수행한다.
- retry, handoff와 fallback도 동일 budget에 포함한다.
- hard limit 초과 시 새 호출을 시작하지 않고 구조화된 종료 사유를 남긴다.
- provider timeout 뒤 실제 과금 여부가 불명확한 경우 reconciliation 상태를 지원한다.
- 사용자 추가 승인으로 budget이 변경되면 새 budget revision과 승인 audit를 기록한다.

### P1. 상태 전이와 실패 의미 확장

현재 공개 상태도는 정상 흐름과 `CANCELLED` 중심이며 운영에 필요한 실패 원인이 부족하다. 최소한 다음 상황을 구분할 수 있어야 한다.

```text
FAILED
TIMED_OUT
BUDGET_EXCEEDED
PERMISSION_REVOKED
PARTIAL_RESULT
RECONCILIATION_REQUIRED
```

공개 상태 enum을 늘릴지 `FAILED + reason_code`로 표현할지는 구현 전에 확정한다. LangGraph 내부 node 상태와 Spring 공개 상태의 mapping table, terminal 여부, retry 가능 여부와 사용자 메시지를 함께 정의해야 한다.

### P1. 요청 등급 routing 계약

`DIRECT_TOOL`, `SINGLE_AGENT`, `DEPARTMENT`, `MULTI_DEPARTMENT`, `HUMAN_REQUIRED` 분류에는 다음이 필요하다.

- schema 검증 가능한 route decision
- 선택된 route의 근거 code와 confidence
- low-confidence 또는 고위험 요청의 `HUMAN_REQUIRED` 전환 기준
- 동일 입력의 route 안정성 평가
- route별 허용 부문, Tool allowlist와 budget profile
- 사용자가 입력을 수정했을 때 재분류하는 조건

Tool allowlist와 transition은 prompt가 아니라 코드에서 강제한다.

### P1. 단계 계획 정렬

Phase 5는 조사 Supervisor를 첫 승격 후보로 평가하지만 실제 `WebResearchProvider`와 공식 source corpus는 Phase 6에 배치되어 있다. 다음 중 하나로 정렬해야 한다.

- Phase 5에서는 내부 knowledge retrieval만 사용하는 Research Supervisor를 평가하고 웹 조사는 Phase 6에서 별도 평가한다.
- 또는 Direct HTTP/PDF와 최소 공식 corpus를 Phase 5 이전으로 이동해 조사 baseline을 먼저 만든다.

어느 경로든 Supervisor 승격 기준과 web provider benchmark 기준을 섞지 않는다.

## 3. 현재 실험 코드 검토

`test/`의 세 파일은 개념 확인에는 유용하지만 자동 회귀 테스트로 간주할 수 없다.

발견 사항:

- 실제 OpenAI 호출을 수행하며 assertion과 deterministic fixture가 없다.
- `langgraph-supervisor`와 `langgraph-swarm` 의존성이 `pyproject.toml`과 lock file에 없다.
- `InMemorySaver`를 사용하는 swarm 예시는 V2의 durable checkpoint 결정과 다르다.
- swarm 예시는 Accepted ADR에서 거부한 자유로운 handoff 구조이므로 V2 구현 예제로 오해될 수 있다.
- 계층형 예제의 `full_history` 전달은 필요한 field만 공유한다는 목표와 다르다.
- 호출 수, token, 실행 시간, permission과 Tool allowlist 제한을 검증하지 않는다.
- 파일명이 `test/`에 있지만 pytest test function, fixture와 pass/fail 조건이 없다.

권장 처리:

1. 현재 파일은 `experiments/agent-patterns/`로 이동하고 각 파일에 실험 목적과 비채택 여부를 명시한다.
2. V2 scaffold의 `apps/agent/tests/`에는 fake model과 stub Tool을 사용하는 pytest를 별도로 작성한다.
3. Supervisor 테스트는 routing, 순환 방지, budget 초과, 병렬 병합, partial failure와 checkpoint resume를 assertion으로 검증한다.
4. 실제 provider smoke test는 기본 CI에서 분리하고 명시적 opt-in, 별도 quota와 test credential을 사용한다.

## 4. 권장 구현 순서

1. 노출된 키 폐기와 secret scan
2. repository layout, package naming과 V1 보존 위치 확정
3. `TrustedRunContext`, `WorkflowState`, `DepartmentTask`, `DepartmentResult` schema 확정
4. request tier와 route policy table 확정
5. public/internal 상태 mapping과 실패 reason code 확정
6. 중앙 budget guard와 병렬 counter 의미 정의
7. fake model 기반 단일 Agent baseline 구축
8. deterministic routing과 Specialist Tool 호출 구현
9. 동일 dataset으로 단일 Agent와 Supervisor 후보 비교
10. 평가를 통과한 부문만 Department Supervisor로 활성화

## 5. 승인 기준

다음 조건을 충족하면 Supervisor scaffold를 시작할 수 있다.

- 신뢰된 실행 context가 mutable Agent state와 분리되어 있다.
- 부문 입력·출력 schema와 versioning 규칙이 문서화되어 있다.
- 병렬 결과의 reducer, conflict와 partial failure 정책이 정해져 있다.
- budget이 모든 model, Tool, search와 handoff 호출에서 중앙 강제된다.
- Spring 공개 상태와 LangGraph 내부 상태의 mapping이 정의되어 있다.
- Tool allowlist와 transition이 코드로 제한된다.
- live API 실험과 deterministic 회귀 테스트가 분리되어 있다.
- 노출된 자격 증명이 폐기되고 원격 history secret scan이 완료되어 있다.

