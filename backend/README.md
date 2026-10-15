# Backend

Spring Boot가 인증, 워크스페이스 권한, 고객·프로젝트·요구사항·견적, 근거와 감사 기록을 관리한다.

## 패키지 구조

```text
com.freelanceops.backend
├── domain
│   ├── workspace
│   ├── identity
│   ├── client
│   ├── project
│   ├── requirement
│   ├── quotation
│   ├── knowledge
│   ├── memory
│   ├── notice
│   ├── agenttask
│   ├── outcome
│   ├── agentrun
│   ├── proposal
│   └── internaltool
└── global
    ├── config
    ├── health
    ├── event
    ├── mail
    ├── security
    └── web
```

각 도메인은 구현에 필요한 `client`, `controller`, `dto/request`,
`dto/response`, `entity`, `model`, `repository`, `security`, `service` 패키지를 사용한다.
업무 규칙은 `policy`처럼 도메인 특화 패키지로 확장할 수 있다. 세부 결정은
[`ADR-0017`](../docs/adr/0017-domain-first-spring-packaging.md)을 따른다.

## 서비스별 책임

| 영역 | 서비스 | 책임 |
| --- | --- | --- |
| 실행 시작 | `AgentStartIdempotencyService` | 중복 요청 잠금, 요청 해시와 시작 결과 보관 |
| 크레딧 | `FreeUsageService` | 주간 크레딧 예약·정산과 관리 설정 |
| 라우팅 검토 | `AgentRouteReviewService` | 검토 배정, 투표와 최종 판정 |
| 평가 자료 | `AgentRouteExportService` | 고정 시점의 관측·검토 자료와 당시 단가 내보내기 |
| 검토 통계 | `AgentRouteCanaryService` | 사전 등록한 표본 수에서 통계 구간과 통과 여부 계산 |
| 지식 문서 | `DocumentService` | 문서 생성·확정·보관과 원문 검증 |
| 지식 검색 | `KnowledgeSearchService` | 키워드·벡터·RAPTOR 순위 결합과 중복 제거 |
| 견적 | `QuotationService` | 버전 생성·개정·발행과 권한·프로젝트 상태 확인 |
| 견적 계산 | `QuotationCalculationService` | 단가·근거·할인 정책 검증과 계산 입력 구성 |
| 견적 응답 | `QuotationResponseAssembler` | 항목·가정·근거 묶음 조회와 응답 조립 |

실행 시작·원장·명령 저장은 같은 트랜잭션에서 처리한다. 계산과 응답 조립을 분리해도
워크스페이스 범위와 기존 잠금 순서를 유지한다.

## 로컬 검증

```powershell
.\gradlew.bat test
```

Java 21을 사용한다. Docker가 실행 중이면 Testcontainers가 PostgreSQL 통합 테스트를 수행한다.
Docker가 없으면 해당 테스트가 생략되므로 단위 테스트 통과만으로 전체 검증을 대신할 수 없다.

Windows의 한글 사용자 경로에서 Gradle 테스트 작업자를 실행하지 못하면 사용자 폴더 전체를
사용하지 않는 영문 드라이브 문자에 연결한다. 저장소와 Gradle 캐시가 모두 영문 경로에 있어야 한다.
아래 예시는 사용자 폴더 아래의 `backend`에서 실행한다. Linux CI에는 이 우회가 필요하지 않다.

```powershell
$originalLocation = (Get-Location).Path
$originalGradleUserHome = $env:GRADLE_USER_HOME
if (Get-PSDrive U -ErrorAction SilentlyContinue) { throw 'U 드라이브가 이미 사용 중입니다.' }
subst U: $env:USERPROFILE
try {
    $relativeRepository = $originalLocation.Substring($env:USERPROFILE.Length).TrimStart('\')
    Set-Location (Join-Path 'U:\' $relativeRepository)
    $env:GRADLE_USER_HOME = 'U:\.gradle'
    .\gradlew.bat test
} finally {
    Set-Location $originalLocation
    $env:GRADLE_USER_HOME = $originalGradleUserHome
    subst U: /D
}
```

애플리케이션 실행에는 PostgreSQL의 `app` schema와 app 전용 credential이 필요하다. Python Agent는 이 schema를 직접 읽거나 수정하지 않는다.

## Swagger UI

Swagger는 Spring 공개 API만 문서화하며 기본 설정에서는 비활성화된다. 로컬 개발에서는 `development` profile로 실행한다.

```powershell
$env:SPRING_PROFILES_ACTIVE = 'development'
.\gradlew.bat bootRun
```

- Swagger UI: `http://localhost:8080/swagger-ui.html`
- OpenAPI JSON: `http://localhost:8080/v3/api-docs`

Compose는 기본적으로 `development` profile을 사용한다. Swagger UI 자체는 인증 없이 열리지만 보호된 `/api/v2/**` 실행에는 로그인으로 발급받은 Bearer access token이 필요하다. Swagger의 `Authorize`에 access token을 입력해 호출할 수 있다. Agent 내부 API 계약은 `contracts/openapi/`에서 별도로 관리하며 이 Swagger에 포함하지 않는다.

## 사용자 인증

Spring이 사용자 계정, BCrypt 비밀번호 검증, access JWT와 refresh token 수명주기를 소유한다.

- `POST /api/v2/auth/register`: 계정과 첫 OWNER workspace를 생성하고 token pair를 발급한다.
- `POST /api/v2/auth/login`: 이메일과 비밀번호를 검증하고 token pair를 발급한다.
- `POST /api/v2/auth/refresh`: 기존 refresh token을 폐기하고 새 token pair로 회전한다.
- `POST /api/v2/auth/logout`: 전달된 refresh token을 폐기한다.
- `GET /api/v2/me`: Bearer access token의 UUID subject로 현재 사용자와 workspace 권한을 조회한다.

refresh token 원문은 DB에 저장하지 않고 SHA-256 hash만 보존한다. 운영 환경에서는 32바이트 이상의 무작위 `APP_AUTH_JWT_SECRET`을 secret manager로 주입해야 하며 기본 개발 secret으로는 시작을 거부한다. 자세한 결정은 [`ADR-0018`](../docs/adr/0018-local-user-authentication.md)을 따른다.

## Workspace RBAC

- 모든 업무 resource는 `workspace_id`로 먼저 격리한다.
- controller와 application service는 role 이름이 아니라 `PermissionCode`를 검사한다.
- workspace 생성 시 `OWNER`, `ADMIN`, `MANAGER`, `ESTIMATOR`, `VIEWER`와 permission matrix를 같은 transaction에서 생성한다.
- 다른 workspace의 resource와 membership이 없는 workspace는 `NOT_FOUND`, 같은 workspace의 권한 부족은 `FORBIDDEN`으로 판정한다.
- 마지막 OWNER 제거, ADMIN의 OWNER 변경과 자기 권한 상승 같은 역할 변경 규칙은 `workspace.policy`의 테스트로 보존한다.

PostgreSQL 격리 검증은 Docker가 실행 중일 때 Testcontainers로 자동 수행된다.

## 주요 업무 API

- Client·Project: workspace-scoped CRM과 프로젝트 lifecycle
- Requirement: 원문, 기능, 가정, 질문을 immutable version으로 누적
- Rate Card·Estimation Policy: 단가, 최소 금액, 할인 상한, 세금과 위험 버퍼 설정
- Quotation: 항목별 evidence 또는 assumption을 강제하고 Java 계산기로 draft·revision·publish 수행
- Knowledge: 문서 provenance와 chunk를 저장하고 PostgreSQL full-text·pgvector 후보를 RRF로 결합
- Outcome: 실제 매출·원가·공수와 WBS 회고를 저장해 견적 calibration 근거로 사용

발행된 견적은 직접 수정하지 않는다. 변경은 `/quotations/{quotationId}/revisions`에서 새로운 immutable version으로 생성한다. 세부 결정은 [`ADR-0019`](../docs/adr/0019-immutable-grounded-quotation.md)와 [`ADR-0020`](../docs/adr/0020-hibernate-vector-hybrid-retrieval.md)을 따른다.

## 견적 이력 조회

화면에서는 `GET /api/v2/workspaces/{workspaceId}/projects/{projectId}/quotations/page`를 사용한다.
응답은 `{ "items": [QuotationResponse], "nextCursor": "커서 또는 null" }`이다.
`limit` 기본값은 50이고 1~100까지 허용한다. 이전 이력이 필요할 때만 `nextCursor`를 `cursor`로 전달한다.

정렬은 `created_at DESC, id DESC`이며 시각이 같아도 ID로 순서를 정한다. 다음 페이지는 PostgreSQL의
`(created_at, id) < (:createdAt, :id)` 행 비교로 조회한다. 커서는 정렬 위치만 나타내며 페이지마다
워크스페이스 권한과 프로젝트 범위를 다시 확인한다. 경계 행이 삭제되어도 다음 페이지를 읽을 수 있다.
여러 요청에 걸친 스냅샷은 아니므로 새 견적은 새로고침할 때 보이고, 삭제된 과거 항목은 사라질 수 있다.

비어 있지 않은 페이지는 견적 쿼리 한 번(`limit + 1`, 전체 개수 조회 없음)과 하위 테이블 쿼리 세 번을 실행한다.
하위 쿼리의 견적 ID는 각각 최대 100개다. 빈 페이지는 하위 조회를 생략하며 권한·프로젝트 확인 쿼리는 별도다.
항목·가정·근거를 따로 읽어 조인으로 인한 행 증식을 피하고 상세 조회와 같은 응답 형식을 유지한다.

`GET /api/v2/workspaces/{workspaceId}/quotations/{quotationId}/latest`는 같은 견적 계열의 최신 버전을 반환한다.
개정 충돌이 발생하면 전체 이력을 다시 읽는 대신 이 API로 최신 버전을 확인한다.

기존 `GET .../projects/{projectId}/quotations`는 전체 배열을 반환하는 호환 API로 유지한다.
하위 조회는 100개 단위로 나눠 `1 + 3 * ceil(N / 100)`번 실행하지만 전체 응답 크기와 메모리는 제한하지 않는다.
새 화면에서는 `/page`를 사용한다. 호환 경로를 제거하려면 별도의 API 버전 결정이 필요하다.

새 프런트엔드보다 `/page`와 `/latest`를 지원하는 Backend를 먼저 배포한다. 해당 복합 인덱스를 추가하는
Flyway 마이그레이션은 동시 인덱스 생성 방식이 아니므로 운영 테이블 크기와 잠금 시간을 고려한다.
기존 마이그레이션은 체크섬 검증 대상이므로 스키마 변경은 새 파일에 작성한다.
