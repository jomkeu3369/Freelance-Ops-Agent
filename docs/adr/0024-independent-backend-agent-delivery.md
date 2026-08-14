# ADR-0024: Backend와 Agent의 독립 CI/CD

- 상태: Accepted
- 결정일: 2026-08-14

## Context

V2는 하나의 repository에 Spring Backend와 Python Agent를 두지만 두 서비스는 서로 다른
runtime, dependency graph, test와 image를 가진다. 기존 CI는 한 workflow 안에서 모든 검사를
실행했고 Production CD는 두 image에 하나의 tag를 강제했다. 이 구조에서는 한 서비스만
변경해도 다른 서비스의 build·배포가 필요하고, 장애가 발생하면 두 서비스를 함께 rollback해야
했다.

두 서비스는 같은 Vultr VM과 Compose project를 사용하므로 완전히 동시에 배포하면 Compose
상태와 배포 marker를 서로 덮어쓸 수 있다. 또한 Spring 공개 readiness와 Agent 내부 health는
검증 경로가 다르다.

## Decision

- Backend, Agent, Frontend와 공통 Contracts & Compose 검사를 독립 GitHub Actions workflow로 관리한다.
- `contracts/**` 변경은 서비스 경계에 영향을 주므로 Backend·Agent·Contracts & Compose CI를 모두 실행한다.
- Frontend CI는 typecheck·test·lint를 담당하고, 중복되는 Next.js build와 Preview·Production
  배포는 Vercel에 위임한다.
- Backend와 Agent는 각각 독립 immutable image tag를 사용한다.
- Production CD는 `Backend Production CD`와 `Agent Production CD`로 나누고 각 서비스 image만
  build·push·교체한다.
- 두 CD의 실제 서버 반영 job은 repository 공통 concurrency group으로 직렬화한다. image build는
  독립적으로 수행할 수 있다.
- 성공한 tag는 `.backend-deployed-tag`와 `.agent-deployed-tag`에 따로 기록하고 실패 시 변경한
  서비스만 직전 tag로 rollback한다.
- Agent는 Docker 내부 `/health`, Backend는 loopback Spring readiness와 공개 readiness를
  검증한다. Backend CD가 외부 진입점인 Caddy를 함께 보장한다.
- 초기 bootstrap은 Agent 다음 Backend 순서로 실행한다. 두 서비스를 같은 tag로 복구해야 하는
  경우 호환용 coordinated `deploy.sh`를 유지한다.
- Frontend Production 배포는 ADR-0010의 Vercel 배포를 유지하며 Vultr CD에 포함하지 않는다.

## Consequences

### 장점

- Backend-only 또는 Agent-only 변경이 상대 서비스의 image build와 재시작을 유발하지 않는다.
- 서비스별 배포 이력과 rollback 단위가 실제 runtime 경계와 일치한다.
- Agent 변경 실패가 정상 Backend image까지 되돌리지 않는다.
- CI 결과가 서비스별로 분리되어 실패 원인과 소유 영역이 명확하다.

### 비용과 위험

- Backend와 Agent의 계약 호환성을 독립 tag 조합마다 관리해야 한다.
- 동일 VM과 Compose project를 공유하므로 서버 반영은 직렬화해야 한다.
- 첫 배포 순서와 서비스별 marker가 손상되면 독립 배포 전 bootstrap 또는 marker 복구가 필요하다.
- GitHub branch protection의 기존 `V2 CI` 필수 check 이름을 새 workflow 이름으로 갱신해야 한다.

## 검증 기준

- Backend 변경은 Backend CI만, Agent 변경은 Agent CI만 실행된다.
- 계약 변경은 Backend·Agent·Contracts & Compose CI를 모두 실행한다.
- 서비스별 CD가 상대 서비스 container를 재생성하지 않는다.
- Backend와 Agent의 독립 tag marker가 기록되고 실패 시 대상 서비스만 rollback된다.
- 동시에 요청된 두 Production 배포의 서버 반영 job은 겹치지 않는다.
