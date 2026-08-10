# Backend

Spring Boot가 인증, workspace-scoped RBAC, 고객, 프로젝트, 요구사항, 견적, Evidence Ledger와 감사 기록을 소유한다.

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

Compose는 기본적으로 `development` profile을 사용한다. Swagger UI 자체는 인증 없이 열리지만 `/api/**` 실행에는 HTTP Basic 인증이 필요하다. 실제 인증 구현 전에는 Spring 시작 로그에 출력되는 개발용 사용자 정보를 사용한다. Agent 내부 API 계약은 `contracts/openapi/`에서 별도로 관리하며 이 Swagger에 포함하지 않는다.

## Workspace RBAC

- 모든 업무 resource는 `workspace_id`로 먼저 격리한다.
- controller와 application service는 role 이름이 아니라 `PermissionCode`를 검사한다.
- workspace 생성 시 `OWNER`, `ADMIN`, `MANAGER`, `ESTIMATOR`, `VIEWER`와 permission matrix를 같은 transaction에서 생성한다.
- 다른 workspace의 resource와 membership이 없는 workspace는 `NOT_FOUND`, 같은 workspace의 권한 부족은 `FORBIDDEN`으로 판정한다.
- 마지막 OWNER 제거, ADMIN의 OWNER 변경과 자기 권한 상승은 domain policy에서 거부한다.

PostgreSQL 격리 검증은 Docker가 실행 중일 때 Testcontainers로 자동 수행된다.
