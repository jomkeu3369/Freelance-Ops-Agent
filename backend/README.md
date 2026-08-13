# Backend

Spring Boot가 인증, workspace-scoped RBAC, 고객, 프로젝트, 요구사항, 견적, Evidence Ledger와 감사 기록을 소유한다.

## Package structure

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
│   ├── outcome
│   ├── agentrun
│   └── internaltool
└── global
    ├── config
    └── health
```

일반 도메인은 `controller`, `dto/request`, `dto/response`, `entity`, `repository`,
`service`를 기본으로 사용한다. 업무 규칙은 `policy`, 외부 연동은 `client`, 도메인 전용
인증은 `security`로 확장한다. 세부 결정은
[`ADR-0017`](../docs/adr/0017-domain-first-spring-packaging.md)을 따른다.

## Local verification

```powershell
.\gradlew.bat test
```

Windows 사용자 경로에 한글이 포함되어 Gradle test worker가 classpath를 읽지 못하면 저장소를 임시 ASCII drive에 연결해 실행한다. CI의 Linux runner에는 이 우회가 필요하지 않다.

```powershell
$repoPath = (Resolve-Path ..).Path
subst R: $repoPath
Set-Location R:\backend
$env:GRADLE_USER_HOME = 'R:\.gradle-local'
.\gradlew.bat test
Set-Location C:\
subst R: /D
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

## User authentication

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
- 마지막 OWNER 제거, ADMIN의 OWNER 변경과 자기 권한 상승은 domain policy에서 거부한다.

PostgreSQL 격리 검증은 Docker가 실행 중일 때 Testcontainers로 자동 수행된다.

## Core product APIs

- Client·Project: workspace-scoped CRM과 프로젝트 lifecycle
- Requirement: 원문, 기능, 가정, 질문을 immutable version으로 누적
- Rate Card·Estimation Policy: 단가, 최소 금액, 할인 상한, 세금과 위험 버퍼 설정
- Quotation: 항목별 evidence 또는 assumption을 강제하고 Java 계산기로 draft·revision·publish 수행
- Knowledge: 문서 provenance와 chunk를 저장하고 PostgreSQL full-text·pgvector 후보를 RRF로 결합
- Outcome: 실제 매출·원가·공수와 WBS 회고를 저장해 견적 calibration 근거로 사용

발행된 견적은 직접 수정하지 않는다. 변경은 `/quotations/{quotationId}/revisions`에서 새로운 immutable version으로 생성한다. 세부 결정은 [`ADR-0019`](../docs/adr/0019-immutable-grounded-quotation.md)와 [`ADR-0020`](../docs/adr/0020-hibernate-vector-hybrid-retrieval.md)을 따른다.
