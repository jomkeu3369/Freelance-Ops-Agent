# Agent

FastAPI와 LangGraph로 실행 경로 선택, 부서 작업, ReAct 반복, 사용자 확인 후 재개와 모델 호출을 처리한다.
업무 데이터는 Spring이 관리한다. Agent는 위임 토큰으로 Spring 내부 API를 호출하며 업무 테이블에 직접 접근하지 않는다.

## 코드 구성

| 경로 | 책임 |
| --- | --- |
| `src/main.py` | FastAPI 생성과 요청 의존성 연결 |
| `src/api/` | 기능별 HTTP 처리. 인증 의존성과 오류 응답은 공통 모듈로 공유 |
| `src/runtime/bootstrap.py`, `lifespan.py` | 실행 서비스 구성과 시작·종료 순서 |
| `src/runtime/runs.py` | 실행 접수, 재개, 취소와 예산 정산 조정 |
| `src/runtime/run_contracts.py`, `run_state.py`, `memory_store.py`, `postgres_store.py` | 공통 실행 계약, 사용량 집계와 저장소 구현 |
| `src/runtime/executor.py` | 선택한 경로에 따라 부서 작업 실행 |
| `src/runtime/department_prompts.py`, `execution_events.py`, `run_progress.py` | 작업 지시문 구성과 관측·진행 이벤트 전달 |
| `src/providers/` | 응답 계약, 스키마 정규화, 재시도와 공급자별 통신 |
| `src/routing/`, `retrieval/`, `web_research/` | 경로 판단, 프로젝트 자료 검색과 외부 근거 수집 |
| `src/attachments/` | 격리된 작업자에서 첨부파일 읽기와 로컬 OCR |
| `migrations/` | Agent 전용 PostgreSQL 스키마 변경 |
| `resources/`, `evaluation/` | 배포용 스킬·라우팅 자료와 버전이 고정된 평가 기준 |

주석과 docstring은 한글로 작성한다. 함수 선언은 한 줄로 쓰고 선언·호출의 마지막 인자에는 쉼표를 붙이지 않는다.
모델 지시문, API 필드·오류 코드와 원본 스킬 자료는 실행 계약과 평가 재현에 사용하므로 표기를 보존한다.

## 로컬 실행과 검증

Python 3.12와 uv를 사용한다. 개발 의존성에는 테스트, 정적 검사, 평가 그래프와 Deep Agent 실험 도구가 포함된다.
Docker는 `uv sync --frozen --no-dev`로 운영 의존성만 설치한다.

```powershell
uv sync --locked
uv run --locked uvicorn main:app --app-dir src --host 127.0.0.1 --port 8000
uv run --locked pytest -ra
uv run --locked ruff check .
uv run --locked mypy
```

PostgreSQL 통합 테스트에는 `AGENT_INTEGRATION_DATABASE_URL`이 필요하다. 실제 OCR 검증은 Poppler·Tesseract와
한글·영문 언어 팩이 설치된 Linux 환경에서 수행한다. 환경이 없으면 건너뛰어지므로 통과 결과와 구분한다.
로컬 인코더를 사용할 때만 `uv sync --locked --extra local-router`로 추가 의존성을 설치한다.
스킬 카탈로그 검사에는 기존 근거 보고서를 덮어쓰지 않을 경로를 지정할 수 있다.

```powershell
uv run --locked python resources/builtin-skills/validate_catalog.py --output catalog-validation.json
```

## 내부 API

- `GET /version`, `GET /health`: 서비스 버전과 프로세스 생존 상태
- `GET /health/readiness`: 시작 완료, 체크포인트와 DB 연결 확인. 준비되지 않았으면 `503 DOWN`
- `POST /internal/v1/agent-runs`: 인증된 실행 접수
- `GET /internal/v1/agent-runs/{runId}`: 상태, 사용자 확인 질문과 결과 조회
- `GET /internal/v1/agent-runs/{runId}/events`: 재연결 커서를 지원하는 SSE 이벤트 조회
- `POST /internal/v1/agent-runs/{runId}/resume`: 중복 적용을 방지하는 사용자 응답 접수
- `POST /internal/v1/agent-runs/{runId}/cancel`: 대기·진행·사용자 확인 대기 실행 취소
- `POST /internal/v1/raptor/build`: Spring이 제공한 원문 조각으로 RAPTOR 노드 생성

DB 준비 상태 점검의 HTTP 대기는 최대 1초이며 프로세스에서 진행 중인 점검 하나를 공유한다.
장애 중 드라이버 취소가 늦어져도 후속 점검을 계속 생성하지 않는다. `/health`는 DB 장애와 별개로 동작한다.
모델의 실제 답변 품질은 이 상태 검사로 판단하지 않는다.

## 저장소와 인증

로컬 개발은 메모리 저장소를 사용한다. Compose와 운영은 `AGENT_RUN_STORE_BACKEND=postgres`를 사용하며,
운영 환경에서는 메모리 저장소를 거부한다. 직접 작성한 SQL 없이 SQLAlchemy 2 비동기 ORM으로 실행 상태와 이벤트를 관리한다.
ORM 모델은 Agent 전용 `agent_runtime` 스키마에만 존재한다.

```powershell
$env:AGENT_DATABASE_URL='postgresql://agent_user:password@localhost:5432/freelance_ops'
uv run --locked alembic upgrade head
```

서버 시작 전에 마이그레이션을 적용한다. Docker도 같은 순서로 시작한다. 테이블이 누락되면 시작에 실패하며 임의 생성하지 않는다.
운영에서는 실행 저장소와 `AsyncPostgresSaver` 체크포인트 모두 PostgreSQL을 사용한다.
체크포인트에는 위임 토큰이나 비공개 추론을 저장하지 않는다. 내부 API는 `AGENT_DELEGATION_TOKEN_PUBLIC_KEY`와
issuer·audience가 일치하는 단기 RSA 서명 JWT만 허용한다. 운영 경로 평가 프롬프트는 비밀 저장소에서
`AGENT_ROUTE_EVALUATOR_SYSTEM_PROMPT`로 주입하고 버전과 승인된 SHA-256을 함께 설정한다.

## 모델과 실험 경계

부서 생성과 RAPTOR 어댑터는 `OPENAI`만 지원한다. 지원이 종료된 Gemini 어댑터와 운영 `google-genai` 의존성은
제거했으며, 기존 데이터의 `GEMINI` 값은 계속 읽되 생성 요청은 외부 호출 없이 거부한다. 공급자를 자동으로 바꾸지
않으며 시간 초과·429·5xx만 제한적으로 재시도한다. Spring 도구는 버전이 지정된 OpenAPI의 프로젝트 문맥, 도메인 자료,
요구사항 검증과 결정적 견적 계산을 사용한다.

`src/departments/research_deep_agent.py`는 ADR-0013 검증 실험이다. 실행별 파일 권한과 `StateBackend`를 사용하며
범용 하위 Agent와 호스트 셸을 비활성화한다. 같은 평가 데이터의 단일 ReAct 기준보다 품질·비용·지연이 개선되기 전에는
운영 실행기에 연결하지 않는다. `deepagents`와 동적으로 불러오는 `langchain-openai`는 개발 의존성에 둔다.
Deep Agents가 요구하는 `google-genai` 전이 의존성도 개발 환경에만 설치되며 운영 이미지에는 포함하지 않는다.

## 개인 키 실행과 예산

새 개인 키 실행에는 Spring이 발급하고 저장한 `byokBudget`이 필요하다. 실행·작업공간·프로젝트·사용자·키·OpenAI 모델·
추론 수준과 전체 실행 예산이 정확히 일치해야 한다. `platformBudget`과 함께 사용할 수 없으며 키 ID만으로 승인을 우회하지 못한다.
Gemini와 지원이 종료된 모델은 개인 키 실행에서 허용하지 않는다. 범위가 없는 과거 실행에 재개 시 새 범위를 추가하지 않는다.

통신 재시도와 잘못된 JSON 응답의 재시도를 포함한 모든 시도는 백엔드 호출 수와 보수적인 입출력 예약을 먼저 소비한다.
그다음 Agent 시도 기록을 저장하고 키를 다시 조회한다. 취소, 키 조회 실패, 응답 유실과 프로세스 종료에도 예약을 환급하지 않는다.
개인 키의 플랫폼 비용은 0이며 사용자의 공급자 청구액 추정치가 아니다. 실제 사용량으로 예약 한도를 보충하지 않는다.
시도별 출력 상한은 계획된 부서와 재시도에 나눠 배정한다. 임의 작업은 한 부서, 프로젝트 분석은 네 부서를 기준으로 한다.
예를 들어 출력 48,000토큰과 부서별 재시도 한 번을 허용한 프로젝트 분석은 시도당 6,000토큰을 예약한다.
보수적인 상한에 먼저 도달하면 실행이 일찍 종료될 수 있다.

공급자 통신은 선택한 키로 HTTPS Responses 요청을 한 번 보낸다. SDK·환경 키와 청구 헤더를 상속하지 않고
리다이렉트, 환경 프록시와 SDK 재시도를 사용하지 않는다. 기본 서비스 등급, 텍스트 입력, 내장 도구 없음과 `store=false`를 적용한다.
승인·저장·키 조회 후와 공급자 요청 직전에 범위를 다시 검증한다. 처음 발급된 만료 시각은 사용자 응답 대기에도 적용되며,
재개로 기한과 사용량을 초기화하지 않는다. 실행 범위가 닫히면 늦게 도착한 호출도 차단한다. 영속 PostgreSQL 저장소가 필요하다.

개인 키의 임의 작업 경로는 로컬에서 결정한다. 안전성·직접 도구·프로젝트 분석 정책 검사는 유지한다.
프로젝트 자료는 읽기 전용 키워드 검색으로 조회하며 질의 임베딩을 호출하지 않는다. 유료 웹 검색, RAPTOR, 펫 생성,
가정 제안, 분리된 A2A 작업과 Deep Agent 실험은 허용하지 않는다. 내부 프로젝트 부서는 같은 영속 승인 경로로 생성할 수 있다.

개인 키 입력 상한은 실행 전체 150,000토큰이며 부서·재시도·재개를 포함한다. 플랫폼 부담 입력 상한은 50,000토큰이다.
그 외 상한은 출력 48,000토큰, 모델 50회, 180초, 도구 12회, 부서 4개, 계층 깊이 2, 검색 크레딧 2,
재시도 2회와 인계 3회다. 백엔드가 범위를 발급하며 Agent는 한도를 늘리거나 보충하지 않는다.

네 부서 프로젝트 분석은 첫 호출 전에 최소 실행 계획을 검사한다. 한글 요청, 스킬 세 개와 확정된 프로젝트 자료가
150,000토큰 안에서 세 견적안을 만드는지 모의 통신으로 검증한다. 실제 공급자 품질이나 가격 검증과는 별개다.
시도별 프로토콜 여유분 8,192와 정확한 UTF-8 요청 바이트를 예약하며, 초과 계획은 호출 전에 `BYOK_PLAN_INPUT_BUDGET_EXCEEDED`로 거부한다.
이 상한이 모든 도구·재시도 계획의 완료를 보장하지는 않는다. 이후 한도를 소진하면 완료된 부서 결과를 부분 결과로 보존하고,
모든 시도를 기록한 뒤 범위를 닫는다. 보안·만료 오류는 실패로 처리한다. 기존 50,000토큰 범위는 재개해도 원래 상한을 유지한다.
회귀 테스트는 `tests/test_byok_budget.py`와 `tests/test_byok_security_review.py`에서 실제 키와 공급자 통신 없이 수행한다.
