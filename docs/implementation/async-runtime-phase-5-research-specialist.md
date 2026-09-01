# Async Runtime 구현 Phase 5 Read-only Research Specialist

> 기준일: 2026-09-01
> 상태: 구현 및 로컬 검증 완료, PostgreSQL CI 검증 대기

## 1. 범위

첫 비동기 전문 작업자는 `research-read-v1` 하나만 사전 등록한다. 범용 Sub-Agent, shell, write Tool,
재귀 위임은 노출하지 않는다. 기존 `DepartmentTask`, `TaskAttempt`, TaskGuard, PostgreSQL event Outbox와
bounded ReAct harness를 재사용한다.

이번 단계는 Research worker 실행과 evidence 검증을 연결한다. 사용자 soft update/hard redirect/cancel,
checkpoint/retry/provider circuit과 scheduler claim 정책은 후속 단계에서 각각 추가한다.

## 2. 실행 계약

Research worker는 실행 전에 다음 조건을 fail-closed로 검사한다.

- Task와 Attempt의 workspace/run/task/revision identity가 일치한다.
- Task는 `QUEUED`, Attempt는 `QUEUED`다.
- department는 `RESEARCH`, route는 `REACT_AGENT` 또는 `SUPERVISOR`다.
- tool profile은 `READ_ONLY`이며 TaskGuard의 현재 권한·정책·예산 revision 검증을 통과한다.
- `agent.run`, `project.read` 외 write capability는 허용하지 않는다.

## 3. 제한된 도구와 예산

전문 worker가 모델에 노출하는 Tool은 `web_research` 하나다. 입력은 길이가 제한된 `query`만 허용하고,
기존 WebResearch router의 domain allowlist, SSRF 방어, prompt-injection 제외와 timeout을 그대로 적용한다.
검색 credit, Tool call, model call, input/output token과 retry는 Task 실행 snapshot의 budget을 초과할 수
없다.

외부 문서는 untrusted observation으로만 모델에 전달한다. 각 실행에서 content hash로 중복 제거한 뒤
전역 `source:N` ID를 부여하므로 여러 검색을 수행해도 citation 번호가 충돌하지 않는다.

## 4. 독립 Verification

모델의 최종 summary는 최소 한 개의 `[source:N]` 표식을 포함해야 한다. 별도
`ResearchResultVerifier`가 citation 범위와 중복 evidence를 검사하고 검증된 source만
`DepartmentResult.sources`에 포함한다.

검증을 통과한 결과만 `attempt.completed` event에 저장한다. 근거 없음, 잘못된 citation, 예산·Tool·모델
오류는 원문 예외 없이 안정된 failure code만 `attempt.failed` event에 남긴다. prompt, credential,
chain-of-thought는 Task event에 기록하지 않는다.

## 5. 상태와 이벤트

정상 실행은 `Attempt QUEUED → RUNNING → COMPLETED`, `Task QUEUED → RUNNING → COMPLETED`로 진행한다.
시작 event의 phase는 `RESEARCH`, 완료 event의 phase는 `VERIFICATION`이고 milestone은 사용자에게
보여줄 수 있는 사실만 포함한다. 실패는 Attempt와 Task를 `FAILED`로 끝내며 event/outbox 전달은 Phase 3
계약을 사용한다.

## 6. 검증 기준

- read-only Research happy path와 구조화 결과
- source citation 검증 및 근거 없는 결과 거부
- write profile 거부와 기존 TaskGuard 재검증
- started/completed/failed event 순서와 sanitized failure payload
- 전체 Agent 회귀, Ruff와 strict mypy
- PR CI의 실제 PostgreSQL migration/event Outbox 통합 및 Agent image 빌드
