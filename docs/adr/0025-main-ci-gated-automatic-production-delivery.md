# ADR-0025: main CI 통과 후 자동 Production 배포

- 상태: Accepted
- 결정일: 2026-08-14

## Context

ADR-0024는 Backend와 Agent의 image, 배포 marker와 rollback 단위를 분리했지만 Production CD의
시작은 `workflow_dispatch`에 의존했다. 이 방식은 release 승인에는 유용하지만 `main`에 반영된
변경이 CI 통과 후에도 별도 조작 없이는 배포되지 않아 지속적 배포를 제공하지 않는다.

Backend와 Agent는 같은 Vultr VM과 Compose project를 사용한다. 따라서 공통 계약·Compose·배포
script 변경에서 두 서비스를 동시에 교체하면 안 되며, 최초 bootstrap과 동일하게 Agent 성공 후
Backend를 배포해야 한다. PostgreSQL infra 변경은 데이터 손실 위험이 있으므로 애플리케이션 CD와
같은 자동 적용 범위로 취급할 수 없다.

## Decision

- `main`의 배포 관련 경로가 변경되면 `Production Auto CD`를 자동 실행한다.
- Agent, Backend와 Contracts & Compose CI를 재사용 가능한 `workflow_call` gate로 실행하고 관련
  gate가 모두 성공한 경우에만 image build와 서버 배포를 시작한다.
- 자동 image tag는 `agent-<git-sha>`와 `backend-<git-sha>`를 사용해 commit과 배포 artifact를
  일대일로 연결한다.
- Agent-only 변경은 Agent만, Backend-only 변경은 Backend만 배포한다.
- 계약, 공통 Compose 또는 공통 배포 script 변경은 두 서비스를 배포하며 Agent 성공 후 Backend를
  배포한다.
- Caddy 변경은 Backend만 배포한다.
- `docker-compose-infra.yaml`과 PostgreSQL 초기화 변경은 계약·Compose CI만 자동 실행하고 운영 DB에
  자동 적용하지 않는다. DB infra 변경은 별도 migration·backup·restore 검토를 요구한다.
- 실제 서버 반영은 기존 `v2-production-deploy` concurrency group으로 직렬화하고 서비스별 readiness,
  marker와 rollback을 유지한다.
- 기존 `Agent Production CD`와 `Backend Production CD`의 `workflow_dispatch`는 장애 복구와 명시적
  재배포를 위해 유지한다.
- Frontend는 ADR-0010에 따라 Vercel 배포를 유지한다.

## Consequences

- 배포 관련 `main` 변경은 CI Green 이후 별도 버튼 없이 Production에 반영된다.
- CI 실패, image build 실패, Agent 배포 실패 시 후속 Backend 배포는 실행되지 않는다.
- SHA tag로 source, image와 배포 marker의 대응 관계가 명확해진다.
- Production environment에 required reviewer가 설정되어 있으면 자동 배포가 승인 대기 상태가 되므로
  완전 자동화를 사용할 때 해당 protection rule을 제거해야 한다.
- 1 vCPU·2GB staging에서는 자동 배포 후 memory, swap, OOM과 p95 latency를 관찰하고 한계를 넘으면
  최소 2 vCPU·4GB로 증설한다.

## 검증 기준

- Agent-only `main` 변경은 Agent CI와 Agent CD만 실행한다.
- Backend-only `main` 변경은 Backend CI와 Backend CD만 실행한다.
- 공통 Compose 변경은 Contracts & Compose CI를 포함해 두 서비스 CI를 통과한 뒤 Agent→Backend
  순서로 배포한다.
- 실패한 CI 또는 Agent 배포 뒤에는 Backend 배포가 시작되지 않는다.
- 성공 marker에는 workflow를 시작한 commit SHA 기반 tag가 기록된다.
