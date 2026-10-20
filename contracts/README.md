# 서비스 간 API 계약

Spring Boot와 Python Agent가 주고받는 요청·응답의 기준이다. LangChain·LangGraph의 내부 객체를 서비스 계약으로 노출하지 않는다. 브라우저가 호출하는 공개 API 전체를 정의하는 폴더는 아니다.

## 진입 파일과 자료형

| 진입 파일                                                  | 호출 방향과 책임                                                                       |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| [agent-internal-api.yaml](openapi/agent-internal-api.yaml) | Spring → Agent. 실행·재개·취소·작업 제어·첨부 추출·상태 조회                           |
| [spring-tool-api.yaml](openapi/spring-tool-api.yaml)       | Agent → Spring. 프로젝트 맥락·도메인 팩·요구사항 검증·견적 계산·검색·개인 키 실행 접수 |

진입 파일에는 경로·인증·응답과 기존 `components/schemas` 이름을 유지한다. 자료형의 본문은 아래 기능별 파일에 두고 상대 `$ref`로 연결한다. 같은 자료형을 진입 파일에 다시 복사하지 않는다.

| 자료형 위치                                | 책임                                              |
| ------------------------------------------ | ------------------------------------------------- |
| `openapi/agent/run-requests.yaml`          | 실행 요청·확인 답변·재개·스킬 선택                |
| `openapi/agent/run-state.yaml`             | 접수·현재 상태·이벤트·라우팅 관측·실행 메타데이터 |
| `openapi/agent/execution-policy.yaml`      | 위임 실행 맥락·모델 선택·비용 범위·한도·사용량    |
| `openapi/agent/task-commands.yaml`         | 작업 제어 명령과 접수 결과                        |
| `openapi/agent/analysis-results.yaml`      | 부문별 분석·근거·견적 초안                        |
| `openapi/agent/attachments.yaml`           | 첨부 추출 결과와 페이지·프레임별 처리 범위        |
| `openapi/agent/pets.yaml`                  | 동료 프로필·선호·픽셀 외형과 예산을 연결한 생성 요청·응답 |
| `openapi/agent/quotation-assumptions.yaml` | 이전 견적 가정 제안 요청·응답                     |
| `openapi/agent/raptor.yaml`                | 이전 RAPTOR 노드 생성 요청·응답                   |
| `openapi/spring/byok-executions.yaml`      | 개인 키 호출 시도의 예약·접수·오류                |
| `openapi/spring/project-context.yaml`      | 프로젝트 맥락과 원문 메시지                       |
| `openapi/spring/domain-packs.yaml`         | 도메인 규칙과 출처                                |
| `openapi/spring/requirements.yaml`         | 요구사항 초안과 검증 결과                         |
| `openapi/spring/quotations.yaml`           | 견적 계산 항목과 합계                             |
| `openapi/spring/knowledge-search.yaml`     | 검색 조건·결과·근거                               |

경로·`operationId`·필드·자료형 이름은 프로그램이 사용하는 식별자이므로 유지한다. 설명과 필드 표시 이름은 한글로 작성한다. 오류 자료형은 두 서비스가 허용하는 필드가 달라 각 계약에 둔다.

## 현재 지원 범위와 호환성

- 새 모델 실행은 OpenAI를 지원한다. 과거 응답용 `Provider`의 `GEMINI` 값과 새 요청에서 허용하는 제공사 목록은 구분한다.
- 동료 생성·견적 가정 제안·RAPTOR 생성의 독립 유료 호출은 현재 비용 예약 절차가 없어 제공사 호출 전에 `409`로 거부한다. 경로와 이전 성공 응답은 호환성을 위해 보존한다.
- `/health`는 프로세스 응답을, `/health/readiness`는 초기화·필수 DB 준비 상태를 확인한다. 준비 상태는 HTTP `200`/`UP` 또는 `503`/`DOWN`이다.
- 기존 요청을 거부하거나 응답을 해석할 수 없게 만드는 변경은 API 버전과 소비 서비스의 변경을 함께 검토한다. 자료형을 옮길 때는 상대 참조와 기존 이름을 확인한다. [OpenAPI 3.1 상대 참조 규칙](https://spec.openapis.org/oas/v3.1.0.html#relative-references-in-uris)을 따른다.

## 공유 검사 데이터

[workspace-credit-contract.json](fixtures/workspace-credit-contract.json)은 Frontend·Backend·Agent가 함께 읽는 합성 검사 데이터다. 실제 계정이나 키는 포함하지 않는다. 이전 주간 크레딧 응답과 START·BYOK·재개·오류 형식의 호환성을 확인하므로 현재 기본 제공 USD 비용 정책의 안내 자료로 사용하지 않는다.

요구사항 앞뒤 공백·줄바꿈, 마이크로초가 포함된 시각, 모델·한도·오류값도 검사 입력이다. 문장 정리를 이유로 값을 바꾸거나 각 언어의 테스트에 복사하지 않는다. 사용처는 `frontend/tests/workspace-credit-contract.test.mjs`, `backend`의 `WorkspaceCreditContractTest`, `agent/tests/test_byok_budget.py`이며 Frontend의 개인 키 표시 검사도 같은 파일을 읽는다.

## 인증과 권한

- Docker 내부 네트워크에서도 인증한다. 업무 API에는 수신 대상이 제한된 짧은 수명의 위임 JWT를 사용한다.
- Agent는 위임된 작업 공간과 권한을 넘을 수 없다. 쓰기 도구는 실행 직전에 Spring에서 현재 권한을 다시 확인한다.
- 개인 키 조회·호출 접수는 활성 BYOK 실행 범위와 현재 권한을 다시 대조한다. 키 응답은 캐시·저장·도구 실행 기록에 남기지 않는다.
- 지표 수집 API는 별도로 설정한 전용 Bearer 토큰을 사용한다. 실행 위임 JWT와 혼용하지 않는다.

## 검사

저장소 루트에서 실행한다. OpenAPI 검증기는 두 진입 파일을 통해 분리한 자료형도 함께 검사한다.

```sh
uvx --from openapi-spec-validator openapi-spec-validator contracts/openapi/agent-internal-api.yaml contracts/openapi/spring-tool-api.yaml
uv run --project agent --locked pytest agent/tests/test_openapi_contracts.py agent/tests/test_architecture_rules.py agent/tests/test_health.py
```

`Contracts & Compose CI`가 OpenAPI 문법과 참조를, `Agent CI`가 모든 자료형 파일의 사용·로컬 참조와 실제 준비 상태 응답을 확인한다. `contracts/**` 변경 시 Backend·Agent CI도 실행한다. 공유 fixture 변경은 Frontend CI에서도 검사한다.
