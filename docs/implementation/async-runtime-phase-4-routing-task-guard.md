# Async Runtime 구현 Phase 4 Routing Profile과 TaskGuard

> 기준일: 2026-08-31
> 상태: 구현 및 로컬 검증 완료, PostgreSQL CI 검증 대기

## 1. 구조와 소유권

Python 라우터는 의미·안전 분류 뒤 결정론적인 실행 프로필을 만든다. Spring 코드는 기존
`agentrun` 도메인의 파일·폴더 구조와 관례를 따라 `agenttask`의 `controller`, `dto/request`,
`entity`, `model`, `repository`, `service`에 배치한다. Spring TaskGuard가 현재 RBAC, workload
identity, 모델 선택과 예산 정책을 다시 검증한 뒤에만 Task와 불변 실행 프로필을 한 transaction에
등록한다.

## 2. 결정론적 실행 프로필

| Route | Model profile | Tool profile | 기본 위험도 |
|---|---|---|---|
| `DIRECT_TOOL` | `direct-tool-v1` | `READ_ONLY` | `LOW` |
| `SIMPLE_LLM` | `simple-llm-v1` | `NONE` | `LOW` |
| `REACT_AGENT` | `react-read-v1` | `READ_ONLY` | `MEDIUM` |
| `SUPERVISOR` | `supervisor-v1` | `READ_ONLY` | `MEDIUM` |
| `HUMAN_REQUIRED` | `human-required` | `NONE` | `RESTRICTED` |

외부 side effect, 민감 데이터, 법률·금융 권한 요구는 위험도를 `HIGH`로 올린다. 되돌릴 수 없는
행동이나 사전 승인이 필요한 요청은 자동 실행하지 않고 `HUMAN_REQUIRED`로 닫는다. 라우팅 프로필
버전은 `route-profile-v1`, 실행 검증 정책 버전은 `task-guard-v1`로 분리한다.

## 3. TaskGuard 검증

- authorization/budget revision과 정책 버전이 현재 값인지 검사한다.
- `agent.run`, `project.read`가 요청 스냅샷, 현재 membership, delegation capability에 모두 있는지
  검사한다.
- 요청 권한이 현재 권한과 위임 권한의 교집합 안에 있고 read-only 최소 권한인지 검사한다.
- route, model profile과 tool profile 조합을 allowlist로 검사한다.
- provider, model과 reasoning effort가 권위 있는 `AgentRun` 선택과 같은지 검사한다.
- Task budget이 상위 실행 예산 및 workspace 정책을 넘지 않는지 검사한다.
- `BOUNDED_WRITE`는 Action Gateway가 구현되기 전까지 fail-closed로 거부한다.

## 4. 영속 계약

`app.agent_task_execution_profile`은 `(task_id, task_revision)`별 실행 결정 snapshot을 보관한다.
workspace/run 복합 외래 키로 tenant 범위를 고정하고 permissions와 열 가지 예산 차원, 서버가 부여한
authorization/budget revision, 정책 버전을 감사 가능하게 저장한다. 데이터베이스 trigger는 profile
update를 거부하며 변경된 지시는 새 Task revision으로만 등록한다.

authorization revision은 현재 유효 권한 집합의 정렬된 SHA-256 지문에서 만든 안정적인 양수 값이다.
RBAC 변경으로 권한 집합이 달라지면 revision도 달라진다. Run budget은 생성 후 불변이므로 최초 budget
revision은 `1`이며 향후 사용자 승인으로 예산 변경을 지원할 때 새 revision을 발급한다.

`agent_run.reasoning_effort`를 영속화해 Task가 요청한 모델 프로필을 문자열 model만이 아니라 provider,
model, reasoning effort 전체로 검증한다.

## 5. 검증 기준

- Python: route/risk/profile mapping, fail-closed router, 권한·revision·budget·policy·model 변조 거부
- Spring: 권한 회수, 필수 권한 누락, write profile, stale policy와 미승인 model profile 거부
- Task와 실행 프로필의 검증-등록-저장 순서 및 transaction 경계
- Flyway의 tenant FK, enum/check 제약과 immutable update trigger
- 전체 Backend/Agent 회귀, Ruff와 strict mypy

로컬 대상 검증은 Agent 테스트와 Ruff/mypy, Backend AgentTask 테스트를 통과했다. 실제 PostgreSQL
migration과 transaction 검증은 PR CI에서 최종 수행한다.
