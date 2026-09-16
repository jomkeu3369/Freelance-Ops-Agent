# 프로젝트 메모리 구현 및 검증 기록 (2026-09-16)

사용자 선택: **AI 문서는 사용자 확인 후에만 다음 분석의 근거로 사용한다.**

## 현재 데이터 흐름

1. 프로젝트 원문 저장·수정, 실행 시작, 추가 질문에 대한 사용자 답변을 `app.source_message`에 append한다. 질문은 `prompt`, 사용자 답변은 `content`로 분리한다. DB 트리거가 원문 UPDATE와 직접 DELETE를 거부한다.
2. `InternalToolService.getProjectContext`가 최신 원문과 해당 원문 이후의 사용자 확인·추가 답변을 제공한다. 이전 원문 이벤트는 보존하지만 현행 요구사항에서는 최신 프로젝트 원문을 기준으로 삼는다.
3. `KnowledgeContextLoader.load`가 원문을 조회하고, 같은 모델의 질의 임베딩으로 Spring 지식 검색을 호출한다. 임베딩 실패 시 키워드 검색으로 전환한다. 검색 권한이 없는 실행에서는 이 선택적 검색 경로가 비활성화된다.
4. `KnowledgeService.search`는 workspace/project 범위, 사용자 확인, 문서 유효기간, 현재 실행 제외를 적용한다. 미확인·대체 문서와 assumption/response는 제외한다. RAPTOR는 요약 노드를 탐색하더라도 원본 leaf 청크만 근거로 반환한다.
5. `OperationalAgentExecutor`는 원문 및 확인 문서를 실제 생성 프롬프트에 전달한다. 원문 우선, 가정 미확정 유지, 충돌 시 질문, 이전 요약만을 근거로 재작성하지 않는 규칙을 적용한다. 사용한 문서 ID는 모델이 작성하지 않고 런타임이 결과에 붙인다.
6. COMPLETED 실행의 COMPLETED REQUIREMENTS 결과만 `GeneratedMemoryListener.completed`가 새 AI 문서로 저장한다. 답변 전체·견적·중간 추론을 자동 색인하지 않는다. `source_message_ids`는 해당 실행의 원문 이벤트를 가리키며, `parent_document_ids`는 실제 제공한 참고 문서를 별도로 기록한다.
7. 근거 자료 화면에서 원문과 AI 문서 **전체**를 비교하고 명시적으로 확인한다. `POST /api/v2/workspaces/{workspaceId}/documents/{documentId}/confirm`에 `expectedVersion`을 보낸다. 서버가 최신 원문 및 문서 버전을 재검사한 후 승인한다.
8. 프로젝트 AI 문서의 승인 뒤 기존 RAPTOR 빌더로 임베딩·벡터 색인을 생성한다. 상태는 INDEXED/PENDING/KEYWORD_ONLY로 응답한다. 색인 실패는 확인 기록을 지우지 않으며 화면에서 재시도할 수 있다. 프로젝트에 속하지 않는 업로드 문서는 확인 직후 키워드 검색에 참여하며, 이후 workspace RAPTOR 재구축에 포함될 수 있다.
9. 프로젝트 원문·추가 답변·사용자 요구사항 확인이 변경되면 이전 AI 문서의 검색 자격을 회수하고 활성 RAPTOR snapshot을 무효화한다. 다음 분석은 최신 원문에서 재생성한다. 늦게 끝난 이전 실행 결과도 superseded로 저장한다.

## RAG Collapse 위험 수준: 중간

자동 생성 → 자동 근거 승격 → 무검토 재생성 루프는 차단했다. 그러나 사람이 잘못된 내용을 확인할 가능성, 문장별 가정 분류의 부정확성, 검색용 RAPTOR 재귀 요약의 편향은 남는다. 논문의 실험을 재현하거나 품질 저하율을 측정한 결과는 아니다.

## 발견된 위험 요소와 이번 수정

| 우선순위 | 문제 | 적용 |
|---|---|---|
| P0 | 생성물과 사용자 사실 혼동 | origin/memory_type/confirmation_status, 확인자·시각, 원문 ID 분리 |
| P0 | 확인 없는 자동 재사용 | 신규·기존 문서 모두 기본 unconfirmed, 검색과 색인에서 제외 |
| P0 | 사용자 원문 덮어쓰기 | DB의 append-only 원문 로그, 수동 요구사항 버전 저장 시 원문 불일치 409 |
| P0 | 프로젝트 간·동일 실행 자기참조 | 서명된 실행의 project/run으로 범위를 고정 |
| P0 | 원문 수정 후 이전 AI 문서 잔존 | 검색 자격 회수, snapshot 무효화, 늦은 결과 및 동시 확인 보호 |
| P1 | 벡터 공간 혼합 | 질의와 청크/snapshot의 embeddingModel 일치 검사 |
| P1 | 생성 문서 수가 검색을 점유 | 원문을 별도 Context로 항상 우선 제공, origin별 우선순위, 문서당 최대 2청크, lexical 중복 제거 |
| P1 | 필요한 RAG 연결 부재 | 에이전트의 실제 실행 경로에서 검색 호출 및 생성 프롬프트 연결 |
| P1 | 검토 화면의 본문 생략 | 전체 원문·청크 표시, 확인 체크박스, 확인/색인 결과 표시 |
| P1 | 키워드 검색 실행 오류 | Hibernate sql() 반환값의 Boolean 명시적 변환 |

## 이미 적용된 보호 장치

- 기존 workspace 권한 및 서명된 delegation 토큰 검사를 유지한다.
- PostgreSQL의 row lock, 문서 낙관적 version, 원문 event order를 함께 검사한다.
- 기존 `version`은 낙관적 동시성 값이다. 의미상 문서 판본은 `revision_number`와 `supersedes`로 별도 관리한다.
- `origin`은 확인 후에도 agent로 유지된다. 업로드 파일은 작성 주체를 증명할 수 없으므로 external로 취급한다.
- 모델 생성 문서는 실제 원문 ID 없이 생성할 수 없다. 이전 문서 ID를 원문 ID처럼 대체하지 않는다.
- 현재 프로젝트 원문, 실행 입력, 사용자 보완 답변 및 수동 확인은 보존한다. 명시적인 프로젝트 삭제는 기존 제품 삭제 정책에 따라 관련 로그도 함께 삭제한다.
- 가정·미결 질문은 수동 요구사항 확인 이벤트에서도 별도로 표시한다. 문서 확인을 가정의 일괄 확정으로 해석하지 않도록 프롬프트와 UI에 명시한다.
- 검색 3회(원문 조회, 임베딩 시도, 검색)는 도구 호출 예산에 포함한다. 너무 큰 원문 Context는 요약으로 몰래 대체하지 않고 오류를 반환한다.
- API 및 모델 호출 없이 동작하는 테스트를 사용하며, 자동 fine-tuning 데이터 수집 경로를 추가하지 않았다.

## 반드시 수정할 항목의 적용 상태

위 P0/P1 변경은 코드에 반영했다. 운영 적용 시 backend/agent/frontend를 함께 배포하고 Flyway V35을 적용해야 한다. 이번 작업에서 운영 DB 변경이나 실제 유료 모델 호출은 수행하지 않았다.

기존 문서는 자동 승인하지 않는다. 기존 프로젝트의 현재 원문은 migration에서 보존하지만, 과거에 이미 덮어쓴 원문을 복구하거나 과거 생성물의 작성자를 추측하지 않는다. 새 로그가 없는 과거 실행은 자동 AI 문서 생성에서 제외한다.

## 권장 개선 항목과 남은 한계

- 의미상 충돌 감지는 프롬프트와 사용자 검토에 의존한다. 결정적 자동 병합·문장별 사실 검증은 구현하지 않았다. 새 프로젝트 원문은 전체 현행 요구사항을 대체하는 입력으로 취급한다.
- 요약의 요약을 완전히 금지하는 구조는 아니다. 생성에 원문을 필수로 동반하고 확인된 요약을 보조 자료로 제공한다. RAPTOR의 검색용 재귀 요약은 유지하며 이를 독립된 사실로 반환하지 않는다.
- 중복 제거는 내용 hash, 단일 실행 문서, 최신 확인 판본, 문서별 청크 제한, 단어 집합 Jaccard에 기반한다. 의미적 paraphrase 제거와 독립 출처 수의 정량 평가·경보는 추가 과제다.
- 문서 전체의 확인과 문장별 요구사항 확인은 다르다. 자유 형식 AI 문서 내 가정을 강제 분리하려면 claim 단위 스키마와 근거 인용 검증, claim별 확인 UI가 필요하다.
- raw 원문은 별도 관계형 이벤트 로그에서 직접 Context로 제공한다. 원문마다 임베딩을 생성하는 별도 vector pool은 구현하지 않았다.
- 수동 업로드가 실제로 AI가 작성한 파일인지 자동 판별하지 않는다. 향후 업로드 시 출처 선언 및 외부 자료 provenance 검증을 보완할 수 있다.
- 색인은 기존 workspace 단위 RAPTOR 전체 재구축을 사용한다. 최대 500청크 제한과 호출 시간 제한을 따른다. 규모가 커지면 durable indexing queue와 증분 색인을 추가하는 것이 적절하다.
- 실제 임베딩·LLM 품질 및 논문 방식의 장기 반복 실험은 별도 평가가 필요하다. 테스트 성공이 의미적 오염 가능성의 완전한 제거를 뜻하지 않는다.

## 변경 파일과 위치

- `backend/src/main/resources/db/migration/V35__grounded_project_memory.sql`: 원문 이벤트, provenance, 확인·대체 제약 및 변경 감지 트리거
- `backend/src/main/java/com/freelanceops/backend/domain/memory/`: `ProjectMemoryService.current/forRun/resolve/confirmRequirement`, 원문 entity/repository/DTO
- `backend/src/main/java/com/freelanceops/backend/domain/agentrun/service/AgentRunProjectionService.java`: 실행 결과 → 문서 생성 이벤트
- `backend/src/main/java/com/freelanceops/backend/global/event/RequirementAnalysisCompleted.java`: 도메인 순환 의존성 없는 완료 이벤트
- `backend/src/main/java/com/freelanceops/backend/domain/knowledge/service/GeneratedMemoryListener.java`: 원문에 연결된 미확인 문서 생성
- `backend/src/main/java/com/freelanceops/backend/domain/knowledge/service/KnowledgeService.java`: 확인, 버전, 근거 검색 정책 및 중복 제한
- `backend/src/main/java/com/freelanceops/backend/domain/knowledge/service/DocumentReviewService.java`: 확인 이후 색인·실패 상태
- `backend/src/main/java/com/freelanceops/backend/domain/knowledge/service/RaptorRetrievalService.java`: leaf 필터링 이후 top-k
- `backend/src/main/java/com/freelanceops/backend/domain/knowledge/service/RaptorIndexTransactions.java`: workspace 동시성 제어
- `backend/src/main/java/com/freelanceops/backend/domain/knowledge/repository/`: scoped keyword/vector/RAPTOR 검색 및 색인 자격
- `backend/src/main/java/com/freelanceops/backend/domain/knowledge/entity/DocumentEntity.java`, `controller/DocumentController.java`, `dto/`: 문서 메타데이터와 확인 API
- `backend/src/main/java/com/freelanceops/backend/domain/internaltool/`: 원문을 포함한 ProjectContext
- `backend/src/main/java/com/freelanceops/backend/domain/requirement/service/RequirementService.java`: 오래된 원문 확인 거절 및 사용자 결정 로그
- `backend/src/main/java/com/freelanceops/backend/domain/project/`: 요구사항 수정자 기록
- `agent/src/retrieval/knowledge_context.py`, `runtime/executor.py`, `main.py`, `contracts.py`, `config.py`: 검색·생성 연결 및 예산, 계보
- `frontend/features/workspace/knowledge/knowledge-panel.tsx`, `project/analysis/analysis-result.tsx`, `project/intake/intake-review.tsx`, `frontend/app/lib/api.ts`: 원문 검토·확인 UI와 캐시 무효화
- `contracts/openapi/*.yaml`, `backend/src/main/resources/application.yml`, `docker-compose.yaml`, `.env.example`: 계약·설정
- backend/agent/frontend의 관련 테스트: 확인 전후 검색, 원문 불변성, scope/model/expiry, 가정 제외, 계보, 실제 프롬프트 전달 및 실패 예산

## 설정

Compose는 `KNOWLEDGE_EMBEDDING_MODEL`을 양 서비스에 전달한다(기본 `text-embedding-3-small`, 1536차원). 개별 실행에서는 backend의 `KNOWLEDGE_EMBEDDING_MODEL`과 agent의 `AGENT_KNOWLEDGE_EMBEDDING_MODEL`을 일치시킨다. 색인 요약 모델은 `KNOWLEDGE_SUMMARY_MODEL`이다. 임베딩을 직접 전달하는 검색 API 호출은 `embeddingModel`도 반드시 포함해야 한다.

## 검증 결과

- Backend: 전체 255개 테스트 통과(실제 PostgreSQL/pgvector Testcontainers 통합 테스트 포함, skip 0).
- Agent: 전체 324개 통과, DB 환경 변수에 의존하는 기존 통합 테스트 8개 skip. 승인 Gate 보존과 메모리 실행 경로 테스트를 포함한다.
- Frontend: TypeScript 검사, 기존/갱신된 55개 테스트, ESLint 통과.
- Python 전체 src/tests Ruff 및 src 85개 파일 Mypy 통과.
- 로컬에는 JDK 21이 없어 JDK 25에서 Java 21 타깃으로 컴파일·테스트했다. JDK 21 런타임 자체의 검증은 수행하지 않았다.
- 임베딩 API 및 실제 LLM을 호출하는 비용 발생 E2E, 운영 배포, 장기 반복 생성 품질 실험은 수행하지 않았다.

- 작업 저장소의 캐시 및 이번 검증용 임시 빌드·설정 414개 경로를 제거했다. 다른 worktree와 전역 캐시는 정리 대상에서 제외했다.

## PR 기준 브랜치 동기화

최신 main의 BYOK·AI 동료 기능을 보존하며 변경을 통합했다. 기존 V33/V34와 충돌하지 않도록 새 마이그레이션을 V35로 변경하고, 개인 키 scope 바깥으로 생성 경로가 벗어나지 않도록 메모리 래퍼를 별도 메서드로 분리했다. 위 검증 결과는 최신 main 통합 이후 다시 실행한 결과다.
