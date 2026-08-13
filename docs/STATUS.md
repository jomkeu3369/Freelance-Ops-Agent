# Freelance Ops Agent V2 작업 인수인계

> 마지막 갱신: 2026-08-13
> 현재 branch: `main`
> 현재 단계: Phase 1 — Spring Boot 기반과 멀티테넌시

> 2026-08-06 메인 페이지 디자인 브리프(디자이너는 1920×1080 메인 페이지만 제작, 반응형·세부 화면은 Codex 담당): [`docs/frontend/MAIN_PAGE_DESIGN_BRIEF.md`](frontend/MAIN_PAGE_DESIGN_BRIEF.md)

## 현재 목표

Spring Boot의 workspace-scoped RBAC와 인증 경계를 완성하고, Client·Project CRUD의 모든 query가 `workspace_id`로 격리되는 기반을 만든다. Agent는 실행 사용자의 유효 permission만 delegation 받을 수 있어야 한다.

## 완료

- 2026-08-13: 다른 PC에서 AI 서버 구현을 이어가기 위한 [`AI 서버 PC 이전 인수인계`](operations/ai-server-pc-handoff-2026-08-13.md)를 작성했다. 현재 working tree가 아직 commit·push되지 않았다는 점, 새 PC 준비·검증 명령, 구현 완료 범위, P0/P1 미완료 항목, secret 이전 금지와 다음 Codex 요청문을 기록했다. 중단 직전 Spring internal Tool API 4종, RS256 audience/run-bound delegation 검증, 현재 RBAC 재검사, JPA workspace-scoped project 조회와 결정적 견적 계산을 추가했다. Backend 전체 테스트 30건은 실패·skip 없이 통과했고 Agent Ruff·strict mypy 40개 module·pytest 117건도 통과했다.
- 2026-08-13: Python Agent의 데이터 접근은 SQLAlchemy 2 async ORM으로 고정하고 애플리케이션 작성 SQL을 금지하는 architecture test를 유지한다. `DIRECT_TOOL` route는 자연어에서 Tool을 추정하지 않고 Spring이 구조화해 전달한 `GET_PROJECT_CONTEXT` operation만 실행하며, `project.read`와 delegation token을 실행 직전에 재검증한다. 활성 `src`·`tests` Ruff, strict mypy 40개 source module, 전체 pytest 117건과 두 OpenAPI 계약의 공식 validator 검증을 통과했다. Spring internal Tool endpoint는 이후 구현했으며, 실제 OpenAI·Gemini 및 Spring delegation token 발급을 포함한 왕복 HTTP E2E는 남아 있다.
- 2026-08-13: AI 서버 completion 감사에서 OpenAI-only provider, 미연결 LangGraph checkpoint, 일부만 구현된 Spring Tool client, 누락된 trace propagation과 오래된 Docker entrypoint를 발견해 보완했다. 부서 structured generation과 RAPTOR embedding/summary는 OpenAI·Gemini를 run별로 명시 선택하며 자동 provider fallback 없이 제한 timeout·retry를 적용한다. `AsyncPostgresSaver`는 `agent_runtime` search path, strict msgpack allowlist와 setup lifecycle을 사용하고 run/thread/trace/provider/model/status의 공개 안전 snapshot만 저장한다. Spring Tool client는 project context, domain pack, 요구사항 결정적 검증, 견적 결정적 계산의 네 OpenAPI 계약을 구현하고 read-only 일시 장애만 제한 재시도한다. W3C `traceparent`를 전파하고 run response에 provider/model/prompt/tool-schema/trace metadata를 추가했으며, production은 PostgreSQL run store·checkpointer·delegation public key·pinned private route prompt가 없으면 시작을 거부한다. 삭제된 package를 가리키던 Agent Docker CMD는 flat `src` entrypoint로 수정했다.
- 2026-08-13: Python Agent의 PostgreSQL 접근을 SQLAlchemy 2 비동기 ORM으로 전환했다. `agent_runtime.agent_run_state`와 `agent_run_event`만 ORM entity로 매핑하고, run 생성·조회·상태 전이·HITL 재개·취소·이벤트 조회에서 직접 SQL 문자열을 제거했다. 상태 전이는 `SELECT ... FOR UPDATE`에 해당하는 ORM row lock으로 직렬화하며, 연결 상태 점검도 SQLAlchemy `select()` 표현식을 사용한다. `GET /internal/v1/agent-runs/{runId}/events` SSE와 `POST /cancel` 계약을 추가했고, JWT의 run scope 및 `agent.run`·`agent.cancel` permission을 적용했다. 핵심 보안·상태 전이에는 한글 주석을 보강하고 신규 운영 함수 선언은 가로형으로 정리했으며, 오래된 `main.py` 설계 메모와 생성 cache·빈 prototype directory를 정리했다.
- 2026-08-13: Python AI 서버의 첫 내부 실행 slice를 완성했다. Spring 전용 `POST/GET /internal/v1/agent-runs`와 resume API, RSA 계열 audience-bound delegation JWT 검증, run/workspace/project/user/permission 교차 검증, camelCase strict DTO를 구현했다. 운영 routing 결과는 제한형 부서 실행기로 연결하고 모델 호출 수·Tool 호출 수·실행 시간·입출력 token·부서 수를 hard limit으로 강제한다. 질문 또는 위험 판정은 HITL interruption으로 전환하며 resume idempotency key를 검증한다. `agent_runtime` 전용 PostgreSQL run-state store는 요청·상태·interruption·결과를 재시작 가능한 형태로 보존하고, 개발 환경만 명시적으로 memory store를 허용한다. 위임 token은 DB·checkpoint·prompt에 저장하지 않고 Spring Tool 호출 중에만 전달하며 Tool 응답의 workspace/project를 다시 검증한다. RAPTOR는 `POST /internal/v1/raptor/build`에서 원문 provenance를 유지한 leaf/summary node를 생성하되 운영 index 영속화와 publish는 Spring 소유로 남겼다. 활성 `src`의 미연결 FAISS/styler/workspace prototype 스텁은 제거했다.
- 2026-08-13: ADR-0013의 Research Deep Agent dependency/security spike를 추가했다. provider와 model을 명시적으로 요구하고, default general-purpose subagent를 꺼 `task` Tool을 제거했으며, `StateBackend`만 사용해 host shell backend를 제공하지 않는다. 파일 read/write는 `/run/{run_id}/**`만 allow한 뒤 `/**`를 deny하고, skill·memory·subagent는 기본 주입하지 않으며 strict `ResearchOutput`을 사용한다. 실제 OpenAI 호출 없이 graph 조립과 Tool surface, namespace 규칙을 테스트했다. 이 spike는 아직 운영 executor에 연결하지 않으며 단일 ReAct baseline 대비 frozen benchmark에서 근거 정확성·task success·비용·p95 latency·Tool 위반률 기준을 통과할 때만 승격한다.
- 2026-08-13: 기업 지원용 포트폴리오 재구성을 위해 초기 cosine·cluster answerability 가설부터 KLUE-MRC 확대, local verifier·hybrid retrieval, LiquidAI A1 학습, BM25+encoder RRF 단독 평가, false automation 분석과 Safety Gate+전 요청 LLM 구조 전환까지 하나의 [AI 신뢰성 case study](portfolio/ai-routing-and-rag-reliability-case-study.md)로 정리했다. 실험 타임라인, RAG·routing 성능, 상관·일치도, selective gate 안전성, 아키텍처 전후, 보안 통제, 비용·latency, 한계·승격 기준을 표로 기록했으며 이력서 bullet과 면접 강조점도 포함했다. 운영 배포와 오프라인 평가를 구분하고 private prompt·secret·개인 경로는 제외했다.
- 2026-08-13: hybrid router 단독 평가 결과에 따라 운영 routing을 `결정적 Safety/Authority Gate → 모든 요청 private-prompt LLM evaluator → 실행 직전 Spring 권한 재검증`으로 전환했다. 승인 필요·비가역 작업·민감정보 외부 전송·필요 권한 미검증은 LLM 전에 `HUMAN_REQUIRED`로 종료하고, evaluator 오류·abstain·prompt manipulation은 fail-closed한다. BM25·LiquidAI·RRF는 기본 비활성화된 optional shadow로만 남기고 LLM 입력에도 포함하지 않는다. LangGraph에는 운영 `route`, 오프라인 관찰용 `router_diagnostic`, Supervisor graph를 분리 등록했다. 기존 ADR-0012는 Superseded 처리하고 [ADR-0015](adr/0015-llm-first-operational-routing.md)를 Accepted 결정으로 추가했다. private evaluator prompt가 미설정된 실제 graph 호출이 외부 API 호출 없이 `HUMAN_REQUIRED/ROUTE_EVALUATOR_UNAVAILABLE`로 종료되는 것을 확인했다.
- 2026-08-13: BM25+encoder RRF가 경계로 판정한 모든 요청을 one-shot LLM evaluator로 보내는 `BoundaryAwareRouteGateway`를 구현했다. LLM은 도구·대화 history 없이 strict JSON schema로 고정 route와 제한된 reason code만 반환하며 자유 서술 출력은 없다. 사용자 요청은 untrusted data로 분리하고 prompt 조작 탐지 결과는 반드시 abstain하도록 검증한다. evaluator 오류·거부·schema 실패·abstain은 `HUMAN_REQUIRED`로 fail-closed한다. private system prompt는 secret·version·승인 SHA-256 세 값이 함께 설정되어야 하며 hash가 다르면 시작하지 않고, 결과에는 원문 대신 version/hash만 남긴다. route catalog와 schema enum 순서를 요청 hash로 회전해 위치 편향을 줄였다. 실제 프롬프트 원문과 유료 API 호출 없이 gateway·secret redaction·hash pinning·prompt injection·strict output 계약을 테스트했다.
- 2026-08-13: 라우트 모델의 로컬 1차 판별 코어를 `BM25 label-example 검색 + encoder route score + weighted RRF` 구조로 구현했다. 서로 다른 raw score를 직접 합산하지 않고 route 순위를 결합하며, BM25/encoder 순위·RRF 순위·매칭 example ID를 결정 trace로 반환한다. lexical signal 부재, 두 lane 1위 불일치, fused share 또는 margin 미달 시 route를 강행하지 않고 명시적으로 fallback한다. encoder는 교체 가능한 비동기 포트로 분리해 기존 A1을 운영에 하드코딩하지 않았다. 로더·BM25·RRF·abstain 계약 단위 테스트 7건과 Ruff·strict mypy를 통과했다. 실제 encoder adapter, validation threshold calibration, Luna fallback, Spring policy Gate와 API 연결은 다음 작업이다.
- 2026-08-13: hybrid 요청 분류기 구현의 첫 기반으로 Python Agent에 비동기 pgvector 연결 관리 계층을 추가했다. 이후 직접 SQL을 사용하지 않는 SQLAlchemy 2 async engine·transaction-scoped `AsyncSession` 구조로 전환했으며 `agent_runtime,public` search path, pool 크기·timeout, vector extension/role/schema health와 민감정보 없는 pool stats를 유지한다. Python Agent가 Spring `app` schema를 직접 읽지 않는 경계는 유지한다.
- 2026-08-13: 사용자 승인 아키텍처에 따라 LangChain `deepagents`를 Requirements·Research·Deal Design 부서의 내부 실행 하네스로 채택했다. Global Orchestrator·HITL·부서 간 상태 전이는 기존 LangGraph가, 검증은 별도 workflow와 결정적 Spring Tool이 계속 소유한다. 기본 범용 subagent와 host shell을 비활성화하고 명시적 specialist·Tool allowlist·run 전용 파일공간·workspace-scoped memory를 적용한다. Research부터 단일 ReAct baseline과 비교해 승격하며, `uv.lock`의 `deepagents 0.7.5` 재현과 pre-1.0 upgrade gate를 적용하는 결정은 [ADR-0013](adr/0013-deep-agents-department-runtime.md), 전체 계층은 [Deep Agents 기반 V2 목표 구조](architecture/deep-agents-target-architecture.md)에 기록했다.
- 2026-08-12: 최종 answerability 구조로 Dense+BM25 reciprocal-rank-fusion retrieval, Top-K local cross-encoder, Wilson upper bound 기반 이중 threshold, LLM fallback 비용 추정을 구현했다. Hybrid retrieval은 frozen test에서 Recall@3 `0.82`, Recall@5 `0.87`, Recall@10 `0.91`로 기존 dense Recall@3 `0.72`를 개선했다. Top-5 local verifier는 FAR `0.04`, FRR `0.03`, local coverage `0.17`, fallback `0.83`, 약 `11.9ms/query`였지만 local accept precision이 `0.75`라 최종 허용 gate로는 부족했다. Cross-encoder와 KLUE QA reader가 모두 동의할 때만 처리하는 ensemble은 accept precision `1.0`, FAR `0`, FRR `0.01`이었으나 local coverage `0.03`, fallback `0.97`이라 효율성이 없었다. 따라서 현재 local model은 retrieval reranking·보조 신호로만 사용하고 LLM evidence verifier가 답변 허용을 맡는다. 실제 업무 문서 label로 재학습해 별도 domain frozen test를 통과할 때 local 처리 범위를 확대한다. 전체 가설, 평가 수치, 역할 경계와 승격 기준은 [`Retrieval Answerability Pipeline 평가와 도입 결정`](testing/retrieval-answerability-pipeline.md)에 기록했다.
- 2026-08-12: similarity-only gate의 낮은 F1을 해결하기 위해 세 가지 근거 충분성 verifier를 같은 KLUE-MRC frozen test에 추가 평가했다. 300건 기반 `klue/roberta-small` cross-encoder는 strict F1 `0.158`, KLUE-MRC pretrained QA reader는 strict F1 `0.333`·FAR `0.10`이었다. 이어 KLUE 전체 train 17,554건에서 calibration 150건을 제외하고 만든 query-chunk pair로 2 epoch 학습했다. 불균형 35,689 pair 실험은 strict F1 `0.440`·FAR `0.24`, positive/negative 각 11,765건으로 맞춘 최종 23,530 pair 실험은 strict F1 `0.374`·FAR `0.13`이었다. 최종 모델은 similarity+BM25 F1 `0.256`보다 개선됐지만 목표 FAR `0.10`을 통과하지 못했고, F1 최적 threshold에서는 F1 `0.650` 대신 FAR `0.66`이었다. 따라서 embedding/cluster gate는 폐기하고 `retrieval → local verifier → 불확실 구간 LLM verifier` 구조를 유지하되, 운영 승격은 source-matched calibration set과 유효한 LLM evaluator A/B를 확보할 때까지 보류한다. 로컬 추론은 RTX 5060 Ti에서 query당 약 `6.6ms`였고 추가 OpenAI embedding 비용은 캐시 적중으로 `$0`였다.
- 2026-08-12: Hugging Face `klue/klue` MRC에서 CC BY-SA 4.0 표본 650건을 고정 seed로 추출해 retrieval answerability 평가를 확장했다. train 300, validation 150, frozen test 200을 answerable/unanswerable 50:50으로 구성하고 context hash 기준 split 중복을 차단했다. 650개 문서는 1,564개 overlap chunk가 되었으며 `text-embedding-3-small`로 평가했다. frozen test의 Recall@3은 `0.72`, MRR은 `0.642`였지만, answerability gate의 최고 F1은 semantic+BM25 방식 C의 `0.256`에 그쳤고 false accept rate `0.16`으로 목표 `0.10`을 위반했다. cluster feature를 추가한 D는 false accept rate `0.01` 대신 recall `0.01`로 사실상 전부 거부했다. 선택된 K는 2, cosine silhouette는 `0.079`로 cluster 구조도 약했다. 결론적으로 embedding similarity와 cluster 중심 거리는 retrieval 후보 탐색에는 유효하지만 답변 가능성·근거 충분성 판정 신호로는 부족하다. 다음 비교는 더 많은 동일 feature 표본보다 cross-encoder/NLI/reader verifier와 LLM evaluator를 대상으로 한다.
- 2026-08-12: `agent/tests/유사도측정/유사도측정.ipynb`에 retrieval answerability A~G 오프라인 비교 실험을 추가했다. cosine 정규화, overlap 인접 청크 중복 완화, BM25, spherical K-means와 silhouette 기반 K 선택, cluster 보조 feature, NumPy 경량 gate, validation threshold, cached LLM evaluator와 경계 구간 fallback을 동일 frozen test에서 비교한다. 데모 fixture는 계약·결제·세금·IP·개인정보·SLA·RBAC·검색 등 18개 문서와 균형 잡힌 72개 query로 확장했고 직접 질의, 패러프레이즈, 수치, 복수 문서, 부정형, lexical trap, 근접 미지원과 도메인 외 유형을 포함한다. 방법별 precision·recall·F1, risk-coverage, 오류율·Brier, K별 silhouette와 answerable/unanswerable score·threshold 분포를 분석하는 Matplotlib plot 및 선택적 PNG 저장을 추가했다. PDF/TXT loader와 실행 검증용 API-free Hashing embedder를 분리했으며 FAISS는 운영 경로가 아닌 baseline이라는 ADR-0003 경계를 유지한다.
- 2026-08-12: `agent/tests/model_test/supervisor_model.py`에 GPT-5.6 Luna 기반 bounded Supervisor prototype을 구현했다. 고정된 단방향 graph는 `Main Orchestrator → Requirements Supervisor → Risk Supervisor → Final Verifier` 순서로 실행하며 node별 모델 호출 1회, 전체 model/output-token budget, route 순환 차단, strict structured output, 호출별 token·latency·예상 비용 ledger를 강제한다. OpenAI Responses API adapter와 API 비용 없는 deterministic fake model을 분리했다.
- 2026-08-11: GPT-5.6 Terra 합성 route 데이터 3,000건(학습 2,500·검증 500)을 생성·중복 제거하고 frozen test exact overlap 0건을 확인했다. RTX 5060 Ti에서 LiquidAI routing head를 학습했으며 250→2,500건 validation macro-F1이 `0.330→0.518`로 상승했다. A1 frozen-test accuracy/macro-F1은 `0.540/0.522`, p50은 `21.7ms`였다. Luna는 `0.760/0.688`, p50 `2,040.5ms`였고 McNemar `p=0.01273`이었다. 3-model Judge route pass는 A1/Luna `0.45/1.00`이다. A1 단독 승격은 보류하고 hard-negative·calibration·Luna fallback을 다음 단계로 둔다. 상세 결과는 [`routing benchmark 결과`](../experiments/routing_benchmark/RESULTS.md)에 기록했다.
- 2026-08-11: RTX 5060 Ti에서 재학습 전 LiquidAI A0와 GPT-5.6 Luna B의 50건 A/B 및 독립 3-model Judge 120회 평가를 완료하고 Matplotlib 그래프와 CSV·JSON을 생성했다. A0/B accuracy는 `0.20/0.76`, macro-F1은 `0.067/0.688`, p50은 `50/2,041ms`였다. Luna도 `REACT_AGENT` recall이 `0`이므로 즉시 운영 승격하지 않는다. 이번 OpenAI 비용은 약 `$0.377572`이며 상세 결과는 [`routing benchmark 결과`](../experiments/routing_benchmark/RESULTS.md)에 기록했다.
- 2026-08-11: routing benchmark의 후보 B를 GPT-5.4 nano에서 GPT-5.6 Luna로 변경했다. B의 자기평가를 피하기 위해 Judge panel은 GPT-5.6 Sol·Terra·GPT-5.4 nano 3종으로 분리하고 다수결 집계를 복구했다. 공식 단가 snapshot을 수정하고 Vultr RAM 4GB 배포 제약, LiquidAI A 재학습·승격·기각 절차와 후속 소형 multilingual encoder 후보를 [`재학습 계획`](../experiments/routing_benchmark/FINE_TUNING_PLAN.md) 및 [ADR-0012](adr/0012-hybrid-agent-routing-gateway.md)에 기록했다.
- 2026-08-10: 앞단 라우터를 `Spring 정책 Gate → 프로젝트 전용 경량 분류기 → GPT-5.6 Terra fallback → HUMAN_REQUIRED` 단계로 구성하기로 결정했다. LiquidAI zero-shot 구성은 실패 기준선으로 보존하고 추가 Judge 평가 대상에서 제외한다. CPU 노트북과 CUDA 작업 PC의 역할, 재현 metadata와 후속 benchmark 기준은 [ADR-0012](adr/0012-hybrid-agent-routing-gateway.md)와 [`CUDA benchmark 인수인계`](testing/hybrid-routing-cuda-benchmark.md)에 기록했다.
- 2026-08-10: `experiments/routing_benchmark`의 LLM 평가자를 GPT-5.6 Luna 단일 모델로 고정하고, Pandas CSV·JSON 집계와 Matplotlib A/B·Luna 대시보드를 추가했다. UTF-8 데이터 무결성을 확인한 뒤 50건 라우팅과 동일 표본 40건 Luna 평가를 실제 실행했다. 공개 가능한 최종 `reports/`는 Git 추적 대상으로 전환하고 로컬 절대 경로를 제거했다. 상세 수치와 제한사항은 [`routing benchmark 결과`](../experiments/routing_benchmark/RESULTS.md)에 기록했다.
- 2026-08-10: PostgreSQL 인프라를 `docker-compose-infra.yaml`, Agent·Backend를 `docker-compose.yaml`로 분리했다. 두 Compose project는 명시적인 `freelance-ops-v2-internal` external network를 공유하며 infra를 먼저 기동한다. CI와 로컬 실행 문서도 두 단계 검증으로 변경했다.
- 2026-08-10: Spring Boot 공개 API에 Springdoc OpenAPI 3과 Swagger UI를 추가했다. 기본 환경에서는 비활성화하고 Compose의 `development` profile에서만 활성화하며, `/api/**`만 문서화해 `contracts/openapi/`의 Agent 내부 계약과 분리했다. HTTP Basic 보안 scheme과 `/api/v1/meta` 문서를 추가했다.
- 2026-08-10: 다른 PC에서 작업을 이어가기 위한 [`로컬 Compose 및 Swagger 작업 인수인계`](operations/local-compose-and-swagger-handoff.md)를 작성했다. 전체 Compose 기동 명령, 당시 Swagger 구현 전 상태, 보안 원칙과 다음 작업 순서를 기록했으며 이후 Springdoc 구현 상태로 갱신했다.

- 2026-08-09: `backend/`, `agent/`, `frontend/`, `contracts/`, `infra/` V2 최상위 구조를 확정하고 관련 명세와 ADR-0008의 Python Agent 경로를 `agent/`로 정정했다.
- 2026-08-09: Spring Boot 4.1.0·Java 21·Gradle 9.6.1 기반 backend와 Gradle Wrapper, Spring Security deny-by-default 골격, Actuator health, Flyway `app` schema baseline과 Agent health indicator를 구성했다.
- 2026-08-09: Python 3.12·FastAPI 0.139.2·LangGraph 1.2.9 기반 독립 uv project와 lock file을 구성했다. 요청 등급과 `max_departments`에 따라 최대 4개 부서를 순차 호출하는 제한형 Supervisor graph baseline을 추가했다.
- 2026-08-09: Spring→Agent run API와 Agent→Spring Tool API를 versioned OpenAPI 3.1 계약으로 분리했다. 계약에는 trusted context, provider/model 선택, run budget, 부서 structured result와 resume 흐름이 포함된다.
- 2026-08-09: PostgreSQL + pgvector, 내부 전용 Agent, 외부 진입점 Spring의 초기 단일 Compose를 구성했다. 2026-08-10 infra와 application Compose로 분리했으며 `app_user`와 `agent_user`, `app`과 `agent_runtime` schema 분리 및 Agent port 비공개 원칙은 유지한다.
- 2026-08-09: backend·agent·contract·compose·image build를 검사하는 V2 CI workflow를 추가했다. 실제 배포 대상과 secret이 정해지지 않아 CD 배포 단계는 아직 연결하지 않았다.
- 2026-08-09: `user_account`, `workspace`, `workspace_member`, `permission`, `workspace_role`, `role_permission`, `member_role`, `rbac_audit_event`의 Flyway migration을 추가했다. membership과 role에 `workspace_id` 복합 외래키를 적용해 DB 수준에서도 cross-workspace role 할당을 거부한다.
- 2026-08-09: 31개 안정 permission code와 5개 기본 system role matrix를 구현했다. workspace 생성자는 같은 transaction에서 OWNER membership과 전체 기본 role을 생성받는다.
- 2026-08-09: 활성 membership의 여러 role permission을 합산하는 JPA adapter와 중앙 authorization service를 구현했다. membership 부재·cross-workspace resource는 `NOT_FOUND`, 같은 workspace의 권한 부족은 `FORBIDDEN`으로 판정하고 거부 결과를 audit에 기록한다.
- 2026-08-09: Spring 애플리케이션 코드의 직접 SQL을 Spring Data JPA Repository로 전환했다. Flyway가 schema를 소유하고 Hibernate는 `ddl-auto=validate`만 수행하며, workspace 조회 조건과 DB 복합 외래키를 함께 유지한다. 결정 근거는 ADR-0011에 기록했다.
- 2026-08-09: 마지막 OWNER 보호, ADMIN의 OWNER 변경 차단, 자기 권한 상승 차단 policy와 Spring method security를 추가했다.
- 2026-08-09: 루트의 V1 `src_temp`, Poetry, MongoDB·Kafka Compose와 과거 배포 workflow를 `legacy/v1/`로 이동했다. 과거 workflow는 `.github/workflows` 밖에 보존해 자동 실행되지 않는다.
- 2026-08-09: 혼재하던 `test/`와 `tests/`를 제거하고 추적 가능한 prototype은 `experiments/`, 로컬 notebook·FAISS 산출물은 Git에서 제외되는 `experiments/local_archive/`로 이동했다. 서비스 자동 테스트는 `backend/src/test`, `agent/tests`, `frontend/tests`만 사용한다.
- 2026-08-09: `.gitignore`의 광범위한 `tests/` 규칙이 `agent/tests`까지 제외하던 문제를 수정하고 V2 CI의 중복 push·PR 실행을 `main` push와 pull request로 정리했다.

- 2026-08-06: 메인 페이지 디자인 브리프를 V2 명세와 README에 맞춰 전면 보강했다. Header부터 Footer까지 각 섹션의 목적, 실제 문구, 화면 내용, 시각 방향과 근거 문서를 같은 형식으로 정리하고, 첫 출시 범위를 한국 소프트웨어 개발 프리랜서로 수정했다. 가짜 후기·고객사·성능 수치, 미확정 가격과 “모든 직군 지원” 표현은 사용 금지 콘텐츠로 명시했다.
- `frontend/`에 React 19 + TypeScript + vinext 기반 V2 프런트엔드 콘셉트를 구성했다. Project Intake를 중심으로 고객 원문과 AI 초안의 구분, 12-column gapless bento, 요구사항 accordion, workflow card stacking, 사용자 후기와 CTA를 구현했다.
- 라이트 `Paper Studio`와 다크 `Night Workshop` 테마를 `next-themes`로 제공하고, GSAP ScrollTrigger reveal·scrub·pin motion 및 reduced-motion 대체 동작을 적용했다.
- 소셜 공유 이미지와 Open Graph/Twitter metadata를 추가했다. 배포 시 `NEXT_PUBLIC_SITE_URL`로 공개 origin을 지정한다.
- 프런트엔드 검증 기준으로 `npm run typecheck`, `npm run lint`, `npm test`를 구성했다.
- 한글 UI 글꼴을 프로젝트에 자체 포함된 `Pretendard Variable`로 교체하고 영문 라벨·숫자는 Geist 계열을 유지했다. 한글 헤드라인의 자간과 행간도 가변 글꼴 기준으로 조정했다.
- frontend 작업 방식을 designer-first workflow로 변경했다. 사용자가 레퍼런스 2~3개를 선정하고, Codex가 V2 문서를 디자이너용 자료로 정리하며, 웹디자이너의 1920×1080 HTML·CSS·JavaScript handoff를 Codex가 Next.js·React·TypeScript와 반응형으로 변환한다.
- frontend 배포 기준을 Vercel Preview 검수 후 승인된 revision의 Production 배포로 확정하고 [ADR-0010](adr/0010-designer-first-frontend-vercel.md)과 [`docs/frontend/DESIGN_IMPLEMENTATION_WORKFLOW.md`](frontend/DESIGN_IMPLEMENTATION_WORKFLOW.md)에 기록했다.

- 생성 데이터 재학습의 model collapse와 V2의 RAG corpus 오염을 구분해 검토하고, 초안 격리, retrieval eligibility gate, root provenance, source pool, lineage dedup, index snapshot·rollback과 fine-tuning 차단 방안을 [`docs/reviews/2026-07-29-generated-artifact-recursion-risk-review.md`](reviews/2026-07-29-generated-artifact-recursion-risk-review.md)에 기록했다. 구현 결정은 [ADR-0009](adr/0009-generated-artifact-retrieval-safety.md) Proposed 상태로 사용자 검토를 기다린다.
- V2 Python Agent를 `agent`의 독립적인 uv project로 관리하고 `pyproject.toml`과 `uv.lock`을 dependency 기준으로 사용하는 결정을 [ADR-0008](adr/0008-python-agent-uv-project.md)에 기록했다. `legacy/v1` Poetry project는 V1·prototype 기준선으로 보존한다.
- 완성된 Supervisor를 가정한 Agent·Tool·재시도별 run 실제 원가, route별 사용 횟수 기반 월 비용, 성공 산출물당 원가와 Budget Guard 계산식을 [`docs/operations/supervisor-usage-cost-model.md`](operations/supervisor-usage-cost-model.md)에 기록했다.
- 요구사항 분석 단일 ReAct Stage 1에 `get_project_context`, `get_domain_pack`, `validate_requirement_draft` fixture Tool을 적용하고, 각 Tool의 run당 1회 호출 제한과 최종 구조화 결과의 상태 일관성 검증을 추가했다. 구현 경계와 검증 결과는 [`docs/testing/requirements-analysis-tool-plan.md`](testing/requirements-analysis-tool-plan.md)에 기록했다.
- 현재 요구사항 평가 파이프라인의 dataset 준비, ReAct·Supervisor 내부 실행, 3개 LLM Judge, LangSmith trace와 결과 집계 흐름을 Mermaid graph로 평가 문서에 기록했다.
- Hugging Face `nguyenminh871/software_requirements`를 검토해 61행·3개 text 열의 183개 고유 요청을 확인했고, 정답 label이 없어 원본 상태로는 정확도 benchmark가 될 수 없으며 수작업 label을 추가한 보조 stress dataset으로만 사용하는 판단을 평가 문서에 기록했다.
- LangSmith `ExperimentResults`를 구조별 전체 평균, case 통과율, Judge별 평균과 실패 case로 집계해 터미널 표와 timestamp JSON 보고서로 출력하는 기능을 추가했다.
- `validate_requirement_draft(draft: dict[str, Any])`가 OpenAI strict function schema에서 속성 없는 object로 변환되던 문제를 해결하기 위해 요구사항 초안의 다섯 field를 명시적 Tool 인자로 변경했다.
- Supervisor Agent Tool의 `dict[str, Any]` 입력도 같은 schema 오류를 내지 않도록 `run_context_summary_json`, `requirement_analysis_json` 문자열 계약과 명시적 Pydantic args schema로 변경했다.
- 빈 Judge별 모델 환경변수가 OpenAI에 `model=""`으로 전달되던 문제를 수정하고 prototype, Judge, timeout, retry와 LangSmith project 설정에서 빈 값을 기본값으로 처리하도록 통합했다.
- ReAct 요구사항 분석 prototype과 Requirements Supervisor prompt 초안을 `experiments/requirements/`에 보존했다. 과거 문서에서 설명한 LLM-as-Judge와 LangSmith evaluator 파일은 현재 tree에 없어 복구 또는 재구현이 필요하다.
- prototype 실행 방법, 환경변수, LangSmith 확인 항목과 평가 주의사항을 `docs/testing/requirements-prototype-evaluation.md`에 기록했다.
- 요구사항 분석 테스트에서 Agent 역할, Supervisor용 Agent Tool과 ReAct 업무 Tool을 구분하고 Langflow 연결 및 JSON 계약 예시를 `docs/testing/langflow-requirements-tool-contracts.md`에 기록했다.
- Langflow Desktop 검증에서 별도 Department flow를 `Run Flow` Tool로 Global Orchestrator에 연결하는 절차, action slug·Tool Mode·입력 배선·Tool trace 합격 기준과 `langchain-openai` 실행 환경 점검을 [`docs/testing/langflow-global-orchestrator-runbook.md`](testing/langflow-global-orchestrator-runbook.md)에 기록했다.

- V1 README와 실제 코드 구조 진단
- V2 제품·기술 명세 초안 작성
- PostgreSQL + pgvector 단일 운영 database 결정
- MongoDB, Kafka, 운영 FAISS 제거 결정
- workspace-scoped RBAC와 기본 role/permission matrix 설계
- Spring Boot 제품 backend와 FastAPI/LangGraph Agent 서비스 분리 결정
- OpenAI/Gemini API provider 지원 방향 결정
- 저장소 공통 작업 지침과 ADR 체계 추가
- 자유로운 swarm 대신 제한된 계층형 Supervisor 목표 구조 결정
- `Global Orchestrator → Department Supervisor → Specialist/Tool` 최대 2단계 경계 결정
- 단일 Agent baseline에서 품질이 입증된 부문만 Supervisor로 승격하는 원칙 결정
- Tavily, Crawl4AI, Direct HTTP/PDF를 분리하는 `WebResearchProvider` 경계 결정
- 공식 자료의 source registry, 불변 snapshot, 관할권·기준일·parser version 정책 결정
- 무료 제한, 건별 산출물과 quota 기반 구독을 조합한 초기 수익화 가설 수립
- run별 Agent·Tool·token·검색 credit·시간·원가 hard limit 명세
- 멀티 에이전트 Supervisor 아키텍처 검토 완료
- 검토 결과와 필수 보완 사항을 [`docs/reviews/2026-07-24-multi-agent-supervisor-review.md`](reviews/2026-07-24-multi-agent-supervisor-review.md)에 기록
- Langflow prototype용 Global Orchestrator, 4개 Department Supervisor와 9개 Specialist의 system prompt 초안 작성
- Langflow Tool 연결, structured output, Tool description과 prompt 회귀 사례를 [`docs/agent-prompts/langflow-system-prompts-v1.md`](agent-prompts/langflow-system-prompts-v1.md)에 기록
- Langflow Global Orchestrator 하향식 테스트의 입력 배선, fake Tool과 실제 하위 flow 교체 순서를 prompt catalog에 기록
- Global Orchestrator smoke test용 정상·질문 필요·단순 계산·고위험 routing mock fixture를 prompt catalog에 기록
- GPT-5.6-terra Function Tool 호출 오류에 대한 `reasoning_effort=none` 설정을 prompt catalog에 기록
- 첫 routing smoke test에서 Langflow 내장 `Calculator`·`Current Date` Tool을 비활성화해야 한다는 점을 기록
- 모델 description은 선택사항이며, model profile·Tool 호환성·권장 Agent를 구분해 기록한다는 기준을 prompt catalog에 기록
- mock context를 실제 실행 context로 오인하지 않도록 Trusted Context Builder, State/Budget Builder와 Spring delegation token의 자동화 경계를 prompt catalog에 기록
- Global Agent 출력이 None일 때 Chat Output을 점검하는 최소 flow와 Department Tool Mode 전환 순서를 prompt catalog에 기록
- 총괄 Agent의 독단 응답을 막기 위한 강제 위임 prompt, 고유 Tool action slug와 검색·분석 순서 검증 기준을 prompt catalog에 기록
- Agent 표시 이름과 실제 Tool action slug의 차이, 중복 action 충돌과 mandatory delegation의 flow-level 강제 원칙을 prompt catalog에 기록
- Supervisor·ReAct 요구사항 분석 검증을 위한 P0/P1/P2 Tool, fixture와 단계별 합격 기준을 [`docs/testing/requirements-analysis-tool-plan.md`](testing/requirements-analysis-tool-plan.md)에 기록
- Agent Tool의 역할, ReAct·Supervisor 배치와 단계별 최소 Tool set을 [`docs/agent-tools/TOOL_CATALOG.md`](agent-tools/TOOL_CATALOG.md)에 기록
- `search_similar_projects`를 요구사항·실제 outcome·근거 검색으로 분리하는 책임 경계 결정
- Agent 비교 단계의 Python fixture Tool과 운영 단계의 Spring Tool 구현 경계 기록

## 진행 중

- ADR-0013 Research Deep Agent와 단일 ReAct baseline의 frozen 품질·비용 benchmark
- ADR-0009의 생성 artifact lifecycle, 검색 자격과 재귀 오염 방지 정책에 대한 사용자 검토
- Spring Tool API의 실제 endpoint와 Agent run 발급부를 연결하고, 부서별 Tool catalog를 확장
- Research Deep Agent와 단일 ReAct baseline의 frozen 승격 benchmark
- Langflow system prompt `v0.1.0`과 Agent별 output schema 사용자 검토
- 한국 소프트웨어 개발 프리랜서용 첫 domain/jurisdiction pack 범위 결정

## 다음 작업

### 다음 PC에서 우선 수행

- [`hybrid routing CUDA benchmark 인수인계`](testing/hybrid-routing-cuda-benchmark.md)의 A1 결과를 검토하고, 사람 검수 hard-negative·confidence calibration·Luna fallback 실험 범위를 확정한다.
- `main`을 pull한 뒤 [`로컬 Compose 및 Swagger 작업 인수인계`](operations/local-compose-and-swagger-handoff.md)에 따라 V2 image build와 전체 Compose 기동을 검증한다.
- Docker 환경에서 JPA 기반 PostgreSQL Testcontainers 통합 테스트 4건을 skip 없이 재실행한다.
- 개발 profile에서 `/swagger-ui.html`과 `/v3/api-docs`를 열고, HTTP Basic 인증 후 `/api/v1/meta` 호출을 검증한다.

### 이후 backlog

1. `uv.lock`의 `deepagents 0.7.5`로 Research spike를 만들고 default general-purpose subagent·host shell 비활성화, run-scoped backend와 hard budget 거부 테스트를 추가한다.
2. Research Deep Agent와 단일 ReAct baseline을 동일 frozen dataset에서 근거 정확성, task success, 비용, p95 latency와 Tool 위반률로 비교한다.
3. routing benchmark에 device override와 실행 환경 metadata schema를 추가하고, 학습용 route dataset·group-aware split·confidence calibration 기준을 확정한다.
4. `experiments/local_archive/**/.env`에 남아 있는 자격 증명을 폐기하고 원격 Git history secret scan을 실행한다. 해당 파일은 Git에서 제외한다.
5. ADR-0009를 검토·승인한 뒤 artifact status, provenance, lineage, retrieval eligibility와 index snapshot contract를 V2 명세에 반영한다.
6. Spring이 audience-bound delegation token을 발급하고 Agent 내부 API·Tool API contract test를 연결한다. Agent 측 검증은 완료됐다.
7. Client·Project CRUD에 중앙 authorization service와 workspace-scoped repository query를 적용한다.
8. provider·model·Tool·환율의 첫 `pricing_snapshot` schema와 route별 `estimated_cost`·`actual_cost` 집계 contract를 정의한다.
9. `react_v1.py` Stage 1을 10~20개 고정 fixture와 LangSmith 평가로 실행해 Tool 호출 순서, 요구사항 누락률, 질문 품질과 불필요 호출률을 측정한다.
10. Langflow에 단일 Agent baseline과 Global Orchestrator flow를 구성하고 fake Tool로 prompt 회귀 사례를 검증한다.
11. 사용자가 frontend 레퍼런스 사이트 2~3개와 참고·제외 요소를 전달한다.
12. Codex가 `DESIGN_BRIEF.md`, `CONTENT_MATRIX.md`, `SCREEN_SPECIFICATION.md`, `COMPONENT_INVENTORY.md`, `INTERACTION_GUIDE.md`, `DESIGN_HANDOFF_CHECKLIST.md`를 작성한다.
13. 웹디자이너의 1920×1080 handoff가 준비되면 React·TypeScript 변환과 반응형 구현 범위를 확정한다.
14. Spring→Agent 실제 HTTP contract test와 delegation key rotation 시나리오를 연결한다. Agent endpoint 자체는 완료됐다.
15. 구현된 read-only project-context client에 Spring endpoint를 연결하고 Requirements 전용 draft validator Tool을 추가한다.
16. PostgreSQL `agent_runtime` schema에 LangGraph checkpoint persistence를 연결한다.
17. 실제 staging 대상, image registry와 secret manager를 확정한 뒤 CD workflow를 추가한다.
18. 첫 web research benchmark에 사용할 공식 source corpus와 성공 기준을 정의한다.

## 현재 검증 상태

- 2026-08-13: SQLAlchemy 2 async ORM 전환과 run event/cancel API 추가 후 `uv sync --locked`, 활성 `src` Ruff, strict mypy 38개 source module, 전체 pytest 89건과 OpenAPI YAML UTF-8 parsing을 통과했다. 운영 Python source에서 직접 SQL keyword 문자열과 connection/cursor 기반 query 호출이 없음을 검색으로 재확인했다. 실제 PostgreSQL transaction·row lock 및 pgvector extension 통합 검증은 Docker PostgreSQL을 사용할 수 없는 현재 PC 환경 때문에 아직 수행하지 못했다.
- 2026-08-13: AI 서버 변경 후 `uv sync --locked`, 활성 `src` 전체 Ruff, strict mypy 37개 source module, 전체 pytest 85건이 통과했다. JWT 서명·scope 거부, run/HITL resume, model·token budget, Spring Tool token 비저장·권한 오류 mapping, RAPTOR provenance, routing, pgvector connection manager와 Research Deep Agent security profile을 포함한다. 실제 PostgreSQL 통합 검증은 이 PC에 Docker executable이 없어 수행하지 못했으며, 실제 OpenAI routing/embedding/summary 호출도 private prompt와 배포 secret을 사용하지 않아 수행하지 않았다. OpenAPI YAML은 UTF-8로 parse했다.
- 2026-08-13: 운영 route 전환 코드에 대해 Ruff, strict mypy와 routing/operational graph 테스트 25건을 통과했다. 추가 전체 routing 회귀 범위에서는 Safety Gate·운영 LLM gateway·shadow diagnostic·Supervisor를 포함한 테스트 33건이 통과했다. 실제 OpenAI 호출은 private prompt secret이 설정되지 않아 수행하지 않았으며 비용은 발생하지 않았다. 다음 검증은 secret manager에서 prompt 원문·version·SHA-256을 주입한 뒤 고정 route fixture로 LLM evaluator A/B와 prompt-injection 회귀를 실행하는 것이다.
- 2026-08-13: BM25+LiquidAI A1+RRF hybrid router를 사람이 검토한 균형 frozen test 50건에서 LLM 없이 단독 평가했다. 학습 BM25 corpus와 exact prompt overlap은 0건이었다. Accuracy/Macro-F1은 BM25 `0.660/0.601`, encoder `0.360/0.339`, RRF `0.540/0.488`로 encoder 결합이 BM25를 개선하지 못했다. BM25와 encoder top-1 일치율은 `0.42`, Cohen's kappa `0.267`이었고 RRF margin과 정답 여부의 상관은 `0.333`이었다. lane agreement gate는 coverage `0.42`, 수락 accuracy `0.8095`였지만 실제 `HUMAN_REQUIRED` 자동 수락 4건 중 3건을 비안전 route로 오분류했다. 따라서 경계 요청만 LLM으로 보내는 정책은 기각하고, 재학습 모델이 route별 F1 0.70과 `HUMAN_REQUIRED` recall 0.95를 별도 test에서 통과하기 전까지 로컬 결과는 보조 feature로만 사용하며 LLM이 모든 route를 검증해야 한다. 상세 근거와 plot은 [Hybrid Router 단독 평가](testing/hybrid-router-standalone-evaluation.md)에 기록했다.
- 2026-08-13: LangGraph Studio에서 질문 한 줄로 BM25+LiquidAI encoder+RRF 로컬 라우터를 점검하는 `router_diagnostic` graph를 추가했다. 실제 `LiquidAI/LFM2.5-Encoder-350M-Prompt-Router` 고정 revision과 A1 2,500건 routing-head checkpoint를 사용하고 Torch·Transformers·Safetensors는 `local-router` 선택 extra로 분리했다. 질문 `쇼핑몰 구축 견적을 위해 개발, 디자인, 일정 계획을 통합해 주세요.`의 실제 추론에서 BM25 1위 `SUPERVISOR`, encoder 1위 `REACT_AGENT`, RRF 1위 `SUPERVISOR`로 lane 불일치가 발생해 `LLM_EVALUATION_REQUIRED`로 올바르게 abstain했다. 현재 Agent venv의 PyTorch는 CUDA를 감지하지 못해 CPU로 실행됐다. 진단 graph는 경계 LLM을 호출하지 않고 필요 여부와 전체 순위만 노출하며, 모델 로딩 오류의 내부 경로는 반환하지 않는다.
- 2026-08-13: LangGraph Studio에서 Supervisor를 라우터 없이 직접 호출할 때 `request_tier`가 누락되어 발생하던 `KeyError`를 제거했다. Supervisor 입력 누락은 `MISSING_SUPERVISOR_INPUT`, 잘못된 tier는 `INVALID_REQUEST_TIER`, 1~4 범위를 벗어난 부서 예산은 `INVALID_MAX_DEPARTMENTS`로 구조화해 `INPUT_REQUIRED` 상태로 종료한다. Ruff, strict mypy와 Supervisor graph 테스트 5건을 통과했다. Studio 직접 테스트 입력은 `{"request_tier":"MULTI_DEPARTMENT","max_departments":3}`이며, 실제 운영에서는 hybrid route gateway 결과가 이 입력을 제공해야 한다.
- 2026-08-13: flat `agent/src/` 구조와 맞지 않던 `langgraph.json`의 삭제된 `src/freelance_ops_agent/graph/router.py` 및 존재하지 않는 research graph 등록을 제거했다. 실제 compiled graph인 Supervisor만 `langgraph_app.py` 진입점을 통해 등록해 LangGraph CLI가 평면형 `src`를 안정적으로 import하도록 했다. Ruff, strict mypy와 Supervisor graph 테스트 2건을 통과했고, `langgraph dev` 로그에서 `graph_id=supervisor` import와 application startup을 확인했다. Windows CP949 환경의 `langgraph-api 0.12.3` 리소스 디코딩 문제를 피하려면 실행 전에 `PYTHONUTF8=1`을 설정한다. 로컬 in-memory checkpoint 디렉터리 `agent/.langgraph_api/`는 Git에서 제외했다.
- 2026-08-13: 사용자가 확정한 flat `agent/src/` 구조에 맞춰 중복된 `src/freelance_ops_agent/` package를 제거하고 `api`, `graph`, `infrastructure`, `retrieval`을 `src` 바로 아래로 통합했다. `pyproject.toml`은 배포 wheel을 만들지 않는 uv application project(`package=false`)로 변경했으며 `uv lock`, `uv sync --locked`를 통과했다. pgvector 연결과 RAPTOR 코어를 포함한 대상 테스트 12건, Ruff와 strict mypy가 통과했다. 현재 PC에서는 Docker 명령을 찾을 수 없어 실제 PostgreSQL 연결 통합 테스트는 실행하지 못했다.
- 2026-08-12: answerability verifier 관련 순수 함수·schema·데이터 계약 테스트를 포함한 `agent/tests/유사도측정` pytest와 Python 모듈 Ruff 검사를 통과했다. Hugging Face `klue/roberta-small`과 `ainize/klue-bert-base-mrc`를 로컬 cache에 내려받아 RTX 5060 Ti에서 실제 학습·추론했고 결과 JSON과 PNG를 렌더링했다. OpenAI Docs에서 분류용 저비용 모델로 확인한 `gpt-5.4-nano` LLM evaluator도 구현했으나, 저장된 `experiments/.env` API key가 401 `invalid_api_key`를 반환해 실제 LLM A/B 평가는 실행되지 않았고 API 비용도 발생하지 않았다.
- 2026-08-12: KLUE-MRC 파생 표본의 650행·split별 label 균형·case ID 유일성·context split 비중복과 benchmark loader 계약을 pytest 3건으로 검증했다. 관련 Python 파일의 Ruff와 compile 검사도 통과했다. OpenAI embedding은 837,067 input token, 추정 `$0.01674134`를 사용했으며 결과 plot 두 장을 headless 환경에서 렌더링해 확인했다. KLUE의 `is_impossible`은 원래 짝지어진 context에 답이 없음을 뜻하므로, 전체 650-context corpus 어디에도 우연한 답이 없다는 보장은 없다는 한계가 있다.
- 2026-08-12: 합성 18문서·32청크와 균형 query 72건을 `text-embedding-3-small` 1536차원으로 실제 임베딩해 answerability benchmark를 실행했다. 2회 batch 요청에서 4,940 input token과 추정 `$0.0000988` 비용이 발생했다. Hashing smoke baseline 대비 Recall@3는 `0.75→1.00`, evidence coverage@3는 `0.667→0.958`, MRR은 `0.653→0.958`, cosine silhouette은 `0.144→0.193`으로 개선됐다. 반면 24건 train·14 feature의 calibrated gate E는 F1 `0.267`, G는 `0.471`에 그쳐 작은 학습셋의 과적합과 validation threshold 불안정성이 확인됐다. 결과 embedding과 JSON은 재호출 방지를 위해 Git 제외된 `agent/.uv-cache/similarity-benchmark/`에 저장했다.
- 2026-08-12: 유사도 benchmark 모듈의 Ruff와 Python compile 검사를 통과하고 노트북의 신규 코드 셀을 순서대로 끝까지 실행했다. 확장된 18개 demo 문서는 32개 overlap chunk로 분리됐고 72개 query에서 K=2~12 후보, A~G 지표, Recall@3·evidence coverage@3·MRR과 embedding·LLM 제외 feature latency가 생성됐다. headless Matplotlib로 요약·점수 분포 PNG 두 장도 실제 렌더링했다. demo fixture 결과는 실행 검증일 뿐 품질 근거가 아니며 실제 PDF/TXT, 사람 label, frozen test와 캐시된 LLM 판정 비교는 아직 실행하지 않았다.
- 2026-08-12: 신규 Supervisor model 테스트 5건과 기존 Supervisor graph 테스트 2건, 총 7건을 통과했다. 컴파일된 LangGraph에서 Mermaid 원문과 로컬 SVG를 내보내고, 승인된 Mermaid 렌더러로 PNG 참조 이미지를 생성했다. 지정 Supervisor 파일은 Ruff format/check와 strict mypy를 통과했으며 LLM 호출과 API 비용은 발생하지 않았다. 전체 Agent pytest는 현재 사용자가 수정 중인 `main.py`에서 기존 테스트가 요구하는 `create_app`이 제거된 상태라 별도 실패하며 이번 Supervisor 구현과는 무관하다.
- 2026-08-11: routing benchmark 재학습·평가 파이프라인 단위 테스트 9건과 Ruff를 통과했다. 생성 데이터 3,000건 schema·중복·frozen-test overlap 검사를 통과했고, CUDA learning curve와 A1/Luna 50건 paired 평가, Sol·Terra·nano 120회 Judge, Pandas 표와 Matplotlib 그래프 생성을 완료했다. Judge 호출은 6-way 병렬 및 JSONL 체크포인트 재개 방식으로 검증했다.
- 2026-08-10: routing benchmark 단위 테스트 8건과 Ruff를 통과했다. CPU에서 LiquidAI encoder와 GPT-5.4 nano를 50건 비교한 결과 accuracy는 각각 0.20과 0.72, macro-F1은 0.067과 0.661이었고 exact McNemar `p=0.0001564`였다. GPT-5.6 Luna의 paired route pass rate는 각각 0.20과 0.70이었다. 두 라우터 모두 `REACT_AGENT` 운용 기준에는 미달해 운영 승격하지 않는다.
- 2026-08-10: Springdoc OpenAPI 3.0.3 추가 후 backend 테스트 20건 중 16건이 통과했고 실패는 없었다. Docker를 사용할 수 없어 PostgreSQL Testcontainers 4건은 skip됐다. OpenAPI metadata와 HTTP Basic security scheme 단위 테스트는 통과했지만 실제 Swagger endpoint 기동은 아직 검증하지 않았다.
- 2026-08-09: Agent에서 `uv sync --locked`, pytest 3건, Ruff와 strict mypy를 통과했다. FastAPI TestClient의 `httpx2` 전환 예고 경고 1건은 upstream 호환성 추적 대상으로 남겼다.
- 2026-08-09: Spring source compile과 JUnit test를 통과했다. 현재 PC의 한글 사용자·프로젝트 경로에서는 Gradle test worker classpath 오류가 재현됐으며, ASCII drive와 전용 cache를 사용하면 `BUILD SUCCESSFUL`을 확인했다. Linux CI에는 해당 우회가 필요하지 않다.
- 2026-08-09: 두 OpenAPI 3.1 문서를 `openapi-spec-validator`로 검증했고 당시 단일 Compose config 검증을 통과했다. 2026-08-10 image build는 성공했지만 PostgreSQL·Agent health 실패로 전체 기동은 완료되지 않았으며, 원인 분리를 위해 Compose를 infra와 application으로 나눴다.
- 2026-08-09: Docker Desktop을 기동하고 Testcontainers 2.0.5의 PostgreSQL 17에서 Flyway migration, permission seed, 기본 role provisioning, cross-workspace 복합 FK와 접근 거부 audit 기록을 검증했다. RBAC matrix·인가·불변조건을 포함한 backend 테스트 17건이 실패·skip 없이 통과했다.

- 2026-08-05: frontend designer-first workflow, 1920×1080 handoff, React·TypeScript 변환, responsive 기준과 Vercel Preview/Production gate를 V2 명세, Accepted ADR-0010과 frontend 작업 문서에 반영했다.
- 2026-08-05: 현재 `frontend/` prototype에서 `npm run typecheck`, `npm run lint`, `npm test`를 통과했다. 이 prototype은 최종 visual source of truth가 아니며 웹디자이너 handoff 이후 교체될 수 있다.
- 2026-07-29: 생성 자료 재사용 위험 검토에서 고전적 model collapse의 학습 조건과 V2 inference-time RAG를 구분하고, Proposed ADR-0009와 상세 검토 문서의 상대 링크, lifecycle, P0 방어 항목과 V2 불변조건의 일관성을 확인했다. 실제 corpus contamination benchmark는 아직 실행하지 않았다.
- 2026-07-29: 당시 `src/agent` directory skeleton만 존재해 실행 가능한 scaffold로 간주하지 않았다. 이 상태는 2026-08-09 `agent/` uv project와 lock file 생성으로 해소됐다.
- 2026-07-28: Supervisor 비용 모델의 route별 월 변동비, 성공 산출물당 변동비·완전 원가와 20% guardrail 예시 산술을 재계산했고 V2 명세와 STATUS의 내부 문서 경로를 확인했다. 실제 Provider 단가는 입력하지 않았으며 향후 `pricing_snapshot`에서 versioning한다.
- 2026-07-28: 사용자의 Poetry Python 3.12 환경에서 `react_v1.py` source compile, 세 업무 Tool과 최종 `RequirementsAnalysis`의 OpenAI strict schema, fixture 결정성, `SUCCESS`·`EMPTY`, validator의 `VALID`·`INVALID`·`INVALID_JSON` 분기와 Agent graph 생성을 통과했다. 실제 OpenAI/LangSmith 호출은 실행하지 않았다.
- 2026-07-27: 사용자의 Poetry Python 3.12 환경에서 가짜 LangSmith `ExperimentResultRow`로 Judge 평균, case 통과율, 실패 case, 우수 구조 선택, 터미널 표 출력과 JSON 직렬화 회귀 검사를 통과했다.
- 2026-07-27: 사용자의 Poetry Python 3.12 환경에서 `validate_requirement_draft`, `call_requirement_analyst`, `call_clarification_generator`의 OpenAI strict Tool schema를 검사했다. 모든 schema가 전체 properties를 required에 포함하고 `additionalProperties=false`를 만족했으며 ReAct·Supervisor graph 생성과 검증 Tool 직접 호출을 통과했다.
- 2026-07-27: 사용자의 Poetry Python 3.12 환경에서 Judge별 model, 공통 model, reasoning effort, timeout, retry와 LangSmith project를 빈 문자열로 설정한 회귀 검사를 통과했다. Judge는 `gpt-5.6-luna`, prototype은 `gpt-5.6-terra`, LangSmith project는 평가 기본값으로 정상 fallback했다.
- 2026-07-27: Python source compile과 JSONL 3건 parsing을 통과했고, `poetry.lock`의 LangChain 1.1.0, LangGraph 1.0.4, LangChain OpenAI 1.1.0, LangSmith 0.4.52 조합으로 두 graph, 세 Judge와 세 업무 Tool의 import 및 생성 검증을 통과했다. 실제 OpenAI/LangSmith 호출은 비용과 credential 사용이 필요해 실행하지 않았다.

- V2 frontend prototype은 repository에 포함할 준비가 되었지만 최종 visual source of truth는 아니다. Python Agent와 Spring backend는 실행 가능한 foundation 단계이며 workspace RBAC는 구현됐지만 실제 인증·Client·Project CRUD·LLM provider·Tool 구현은 아직 없다.
- 2026-07-24 Supervisor 구조 검토에서는 live model 실험을 실행하지 않았다. 현재 `experiments/` 파일은 실제 API를 호출하거나 assertion이 없는 실험 script이므로 자동 테스트 결과로 간주하지 않는다.
- 2026-07-24 갱신 문서의 Markdown 공백, ADR 내부 링크, 단계 번호, 미해결 marker와 핵심 결정 일관성을 확인했다.
- `experiments/local_archive/**/.env`는 `.gitignore`에 의해 추적되지 않지만 실제 형식의 자격 증명이 있어 폐기와 재발급이 필요하다.
- 알려진 OpenAI·LangSmith 장기 token pattern과 local archive 경로는 현재 Git history에서 발견되지 않았지만 전용 secret scanner 검증은 아직 필요하다.
- Langflow prompt는 문서 초안만 작성했으며 실제 flow 실행, structured output schema 호환성과 regression evaluation은 아직 수행하지 않았다.
- 2026-08-03: 실행 중인 Langflow Desktop backend가 `1.10.0`이고 전용 Python 환경에서 `langchain-openai 1.4.1` import 및 health/version endpoint가 정상임을 확인했다. 화면의 `No module named langchain_openai` 오류는 현재 저장소 Poetry 환경이 아니라 Desktop build/cache 또는 별도 LFX 실행 환경을 우선 점검해야 하는 상태이며, 실제 Global Orchestrator의 Department Tool 호출 trace는 아직 확인하지 않았다.
- Tool Catalog의 Markdown 구조와 V2 명세 내부 링크를 검증했다.

- 2026-08-09: 구조 정리 후 `agent/tests`의 pytest 3건, Ruff, MyPy와 `frontend/tests`의 Node 테스트 2건, TypeScript typecheck, ESLint를 통과했다. Compose V2 설정도 유효하다.
- 2026-08-09: frontend 의존성 설치 결과 npm audit 기준 취약점 20건(낮음 1, 보통 4, 높음 15)이 남아 있다. 자동 강제 수정은 breaking change 위험 때문에 수행하지 않았으며 CI 정비 단계에서 직접 검토한다.

- 2026-08-09: JPA 전환 후 backend 단위 테스트 15건은 통과했다. Docker Desktop이 중지된 상태여서 PostgreSQL Testcontainers 통합 테스트 4건은 skip되었으며 Docker 기동 후 재검증이 필요하다.
- 2026-08-10: `experiments/classification_benchmark`에 Hugging Face FR/NFR 데이터셋 기반 DistilBERT/MiniLM A/B, paired McNemar와 bootstrap CI, 세 OpenAI Judge 집계, groundedness·hallucination 평가, 실제 token 비용 계산, LangSmith tracing과 Matplotlib PNG 리포트를 추가했다. 단위 테스트 8건과 Ruff를 통과했고 RTX 5060 Ti/CUDA 13.2/BF16에서 full 3-epoch A/B를 완료했다. 두 모델 accuracy는 0.8264로 같고 McNemar p=1.0, macro-F1 delta CI가 0을 포함해 유의한 성능 우열은 없었다. 동일 ID 30건의 세 Judge paired 평가와 LangSmith trace 업로드도 완료했으며 paired verdict 비용은 USD 0.440216이었다.

## 열린 결정

- ADR-0009 생성 artifact lifecycle, retrieval eligibility gate, source quota와 synthetic lineage 제한의 승인 여부
- OpenAI와 Gemini 중 기본 evaluation provider
- chat model과 embedding model의 최초 고정 버전
- Spring Boot와 Spring Security의 최초 고정 버전
- Next.js frontend의 component system과 visual direction
- 첫 유료 검증 가격과 무료·유료 plan별 quota
- 한국 소프트웨어 개발 domain/jurisdiction pack의 공식 source corpus
- Tavily와 Crawl4AI benchmark의 test URL과 합격 기준
- 내부 Tool API를 MCP로 전환할 Phase 7의 구체적 범위
- `TrustedRunContext`와 mutable `WorkflowState`의 정확한 schema
- 병렬 부문 결과의 reducer, conflict와 partial failure 정책
- Spring 공개 상태와 LangGraph 내부 상태의 실패·재시도 mapping
- Phase 5 Research Supervisor 평가와 Phase 6 WebResearchProvider 구현 순서
- Langflow prototype에서 사용할 model, temperature, Agent iteration limit와 memory history 수
- Langflow Structured Response의 중첩 schema를 그대로 사용할지 Pydantic 검증 component를 추가할지 여부

## 주의 사항

- `docs/`는 아직 Git에 commit되지 않은 상태일 수 있으므로 다른 컴퓨터에서 작업하기 전에 `git status`를 확인한다.
- 두 Codex 환경에서 같은 branch를 동시에 수정하지 않고 작업별 feature branch를 사용한다.
- 전체 대화 원문, 개인 일정, secret과 실제 고객 데이터는 공개 저장소에 올리지 않는다.
- 새 작업을 시작할 때 `AGENTS.md`, 이 문서, 관련 ADR과 V2 명세를 먼저 읽는다.
