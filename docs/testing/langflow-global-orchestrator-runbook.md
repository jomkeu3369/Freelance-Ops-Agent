# Langflow Global Orchestrator 검증 Runbook

> 대상: V2 Langflow prototype
> 기준: `Global Orchestrator → Department Supervisor → Specialist/Tool`
> 상태: Prototype validation

## 1. 이번 검증의 결론

별도 Langflow flow로 만든 Department Supervisor를 Global Orchestrator가 호출하게 하려면, 부모 flow에 `Run Flow` component를 추가해야 한다.

```text
Department flow
  Chat Input → Department Supervisor Agent → Chat Output

Global Orchestrator flow
  Chat Input → Global Orchestrator Agent → Chat Output
                         ↑
       Run Flow.Tool × 4 ┘
       requirements_department
       research_department
       deal_design_department
       verification_department
```

하위 flow의 `Chat Output`을 부모 Agent의 `Tools` 포트에 직접 연결하지 않는다. 각 하위 flow를 선택한 `Run Flow`의 `Tool` output을 부모 Agent의 `Tools` input에 연결한다. Langflow는 `Run Flow`를 Tool Mode로 활성화하면 선택한 flow를 Agent action으로 등록한다.

관련 공식 문서:

- [Configure tools for agents](https://docs.langflow.org/agents-tools)
- [Run Flow](https://docs.langflow.org/run-flow)
- [Agents](https://docs.langflow.org/components-agents)

## 2. Flow를 네 개의 Department로 분리

먼저 다음 이름으로 독립 flow를 저장한다.

| Flow 이름 | Tool action slug | 책임 |
|---|---|---|
| `requirements_department` | `requirements_department` | 요구사항 충분성·질문·요구사항 구조화 |
| `research_department` | `research_department` | 승인된 source 조사·근거 정리 |
| `deal_design_department` | `deal_design_department` | 범위·WBS·견적 시나리오 설계 |
| `verification_department` | `verification_department` | 근거·위험·결정적 Tool 결과 검증 |

각 Department flow의 최소 구조는 다음과 같다.

```text
Chat Input → Department Supervisor Agent → Chat Output
```

Department 내부 Specialist를 추가할 때는 해당 flow 안에서만 연결한다. 예를 들어 Requirements Department의 Agent Tool은 `call_requirement_analyst`와 `call_clarification_generator`만 허용한다. Global flow에 Specialist를 직접 연결하지 않는다.

Prototype에서 nested Run Flow가 HITL로 멈추지 않도록 사용자 승인 단계는 부모 flow에 둔다. 하위 flow에서 Human Input을 실행해야 하는 구조는 Run Flow 검증 대상에서 제외한다.

## 3. Global Orchestrator에 하위 flow를 Tool로 연결

Global flow에서 다음을 수행한다.

1. `Run Flow` component를 네 개 추가한다.
2. 각 component의 `Flow`를 해당 Department flow로 선택한다.
3. 각 `Run Flow`의 header menu에서 `Tool Mode`를 켠다.
4. `Edit Tool Actions`에서 action을 하나만 enabled 상태로 둔다.
5. action의 slug를 표의 고유 slug로 바꾸고 description을 입력한다.
6. 네 개 `Run Flow`의 `Tool` output을 Global Orchestrator Agent의 `Tools` input에 모두 연결한다.

권장 description은 다음과 같다.

```text
requirements_department:
새 요청이거나 사용자의 요구사항 답변이 변경된 경우 반드시 먼저 호출한다.
요구사항의 충분성, blocking gap, 최소 확인 질문과 구조화된 requirement 결과를 반환한다.
견적 계산, 외부 검색, 최종 승인과 business write는 수행하지 않는다.

research_department:
요구사항이 READY이고 최신 외부 근거 또는 공식 source가 필요할 때만 호출한다.
source ID/URL, 확인 기준일, 핵심 주장, 충돌과 confidence를 반환한다.
근거 없이 법률 결론이나 견적을 만들지 않는다.

deal_design_department:
요구사항과 필요한 근거가 READY인 경우에만 호출한다.
범위, WBS와 견적 시나리오를 설계하고 계산은 결정적 Tool 결과를 사용한다.
누락된 근거 또는 금액을 추측하지 않는다.

verification_department:
Deal Design 결과가 있고 사용자에게 승인을 요청하기 전에 반드시 호출한다.
evidence, assumption, 위험, 계산 결과와 schema를 검증한다.
CONFLICT/INVALID/HUMAN_REVIEW_REQUIRED이면 승인으로 진행하지 않는다.
```

중요한 구분:

- Prompt Template의 `{available_tools}`는 텍스트 설명용 입력이다. 이 값을 Agent의 `Tools` 포트에 연결하지 않는다.
- 실제 Tool 연결은 `Run Flow.Tool → Agent.Tools` edge다.
- Agent 표시 이름을 바꾸는 것만으로 action slug는 바뀌지 않는다. `Edit Tool Actions`에서 slug와 enabled 상태를 확인한다.
- `CALL_AGENT_MESSAGE_RESPONSE`와 `CALL_AGENT_JSON_RESPONSE`를 동시에 노출하지 말고 첫 테스트에서는 하나만 활성화한다.

## 4. Prompt와 입력 배선

Global flow의 기본 배선은 다음과 같이 고정한다.

```text
Chat Input → Global Agent.Input
Prompt Template.Prompt → Global Agent.Agent Instructions
Global Agent.Response → Chat Output.Message
```

`available_tools`, `budget_remaining`, `run_context_summary`, `workflow_state`, `output_schema_version`에는 Chat Input을 재사용하지 않는다. 첫 실행에서는 각 변수에 고정 mock 문자열을 입력하고, 이후 검증된 State/Budget Builder로 교체한다.

`delegation_token` 원문, API key, 실제 고객 데이터는 prompt나 Langflow memory에 넣지 않는다. 현재 Langflow 검증의 context는 mock 또는 redacted context이며, 운영 단계에서 Spring이 발급한 짧은 delegation token은 internal API boundary에서만 사용한다.

## 5. 단계별 검증 순서

### Stage 0 — Agent 단독 build

Global Agent와 Prompt Template만 남긴다.

- Agent가 `Response`를 반환하는지 확인한다.
- `Response → Chat Output`이 연결되어 있는지 확인한다.
- 이 단계에서는 Tool 호출을 기대하지 않는다.

### Stage 1 — fake Department Tool

네 개의 Run Flow 대신 고정 결과를 반환하는 fake Tool을 연결한다. 다음을 확인한다.

- 정상 요청에서 `requirements_department`가 호출된다.
- 결과가 `NEEDS_INPUT`이면 `research_department`와 `deal_design_department`를 호출하지 않는다.
- READY인 경우에만 다음 부문을 선택한다.
- Tool trace에 action slug, 입력, 결과 status와 순서가 남는다.

### Stage 2 — 실제 Department flow 하나 교체

Requirements Department만 실제 하위 flow로 교체한다. 이후 Research, Deal Design, Verification 순서로 한 번에 하나씩 교체한다. 각 교체 후 Tool action 이름과 출력 schema를 다시 확인한다.

### 권장 smoke-test 입력

```text
중소기업 직원용 웹 시스템의 기능 범위와 견적 시나리오를 정리해 주세요.
직원 로그인, 관리자 계정 관리, 공지사항 CRUD, 파일 첨부와 검색이 필요합니다.
기존 PostgreSQL과 연동하고 관리자와 일반 직원의 권한을 분리해야 하며,
목표 오픈일은 10주 후이고 초기 사용자는 약 50명입니다.
```

호출되지 않은 Tool을 호출했다고 응답만 하는 것은 성공으로 간주하지 않는다. Playground trace에서 실제 action 호출을 확인한다.

## 6. 화면의 `langchain_openai` 오류

화면에 다음 오류가 나타날 수 있다.

```text
No module named 'langchain_openai'
```

Langflow Desktop은 저장소의 Poetry 환경과 별도 Python 환경을 사용한다. 따라서 저장소에서 `poetry install`을 실행해도 Desktop 실행 환경은 바뀌지 않는다.

현재 확인된 이 PC의 Langflow Desktop backend는 다음 상태다.

- Langflow `1.10.0`
- `langchain-openai 1.4.1` 설치됨
- backend health/version endpoint 정상 응답

따라서 현재 화면의 오류는 우선 다음 순서로 복구한다.

1. 현재 flow를 저장한다.
2. Langflow Desktop을 완전히 종료한다.
3. Desktop을 다시 시작한다.
4. 문제가 반복되면 Langflow Desktop의 전용 terminal에서 다음을 실행한다.

```powershell
python -c "import langchain_openai; print(langchain_openai.__file__)"
python -m pip install -U langchain-openai
```

5. 다시 시작한 뒤 해당 Language Model component를 삭제 후 새로 추가하고 flow를 build한다.

`langchain-openai`가 import되는데도 같은 오류가 남으면 이전 build job이 실패한 상태를 재사용하는 경우일 수 있으므로, flow를 다시 열고 component를 새로 추가한 후 build한다. LFX를 별도로 실행하는 경우에는 flow가 요구하는 bundle과 runtime package를 같은 LFX environment에 설치해야 한다.

## 7. Global Agent가 답변만 하고 Tool을 호출하지 않을 때

다음 순서로 확인한다.

1. Global Agent의 `Tools` input에 실제 선이 연결되어 있는지 확인한다.
2. 선의 시작점이 `Run Flow.Tool`인지 확인한다. `Chat Output`이나 `Prompt` output은 Tool이 아니다.
3. Run Flow가 올바른 Department flow를 선택했는지 확인한다.
4. Tool Mode와 action enabled가 켜져 있는지 확인한다.
5. action slug가 네 개 모두 고유한지 확인한다.
6. Global Agent의 Tools metadata에 네 개 action이 표시되는지 확인한다.
7. 단순 인사 대신 반드시 특정 부문이 필요한 입력으로 재실행한다.
8. prompt에 직접 답변하지 말고 해당 Department Tool을 호출해야 한다는 조건과 실패 시 status를 명시한다.

단, `tool_choice=auto`인 Agent는 prompt만으로 호출을 절대 보장하지 않는다. 핵심 업무에서 순서가 필수라면 Global Agent의 분류 결과를 Flow Control이 받아 `Run Flow`를 직접 실행하는 구조로 승격한다. Prompt는 routing 의도를 설명하고, permission·budget·transition과 mandatory execution은 application/flow layer가 강제한다.

## 8. V2 경계 확인

Langflow prototype에서 성공한 Tool 연결을 운영 구조로 간주하지 않는다.

- Browser는 Spring 공개 API만 호출한다.
- Python Agent는 Spring business table을 직접 읽거나 변경하지 않는다.
- write Tool은 실행 직전에 권한을 재검증하고 HITL 승인을 요구한다.
- 금액·세금·할인·합계는 결정적 Java Tool에서 계산한다.
- 결과에는 source, assumption, 계산식과 Tool 실행 요약을 남기고 private chain-of-thought를 저장하지 않는다.
