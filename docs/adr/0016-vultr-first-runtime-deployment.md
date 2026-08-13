# ADR-0016: 초기 Runtime Compute를 Vultr로 통합

- 상태: Accepted
- 결정일: 2026-08-13

## Context

기존 계획은 Spring Boot backend를 AWS EC2에, Python Agent를 Vultr에 분리 배포하는
형태였다. 첫 공개 검증 단계에서 두 provider를 동시에 운영하면 network 보안, 장애 추적,
secret 배포, egress 비용과 CI/CD 권한을 각각 관리해야 한다. 현재는 사용자 수와 부하가
측정되지 않아 이 운영 복잡성을 정당화할 근거가 없다.

Frontend는 ADR-0010에 따라 Vercel Preview와 Production을 사용한다. 여기서 runtime
compute는 Spring Boot, Python Agent와 PostgreSQL을 의미한다.

## Decision

- 첫 공개 검증의 runtime compute provider는 Vultr로 통일한다.
- 초기에는 비용을 낮추기 위해 한 Vultr VM의 Docker Compose에서 Spring Boot, Python
  Agent와 PostgreSQL + pgvector를 실행할 수 있다.
- 외부에는 TLS reverse proxy와 Spring 공개 API만 노출한다. Agent와 PostgreSQL port는
  public firewall과 host port에 공개하지 않는다.
- Spring과 Agent는 같은 private Docker network를 사용하더라도 RS256 단기 delegation
  token을 반드시 검증한다.
- API key, RSA private key, database password와 private routing prompt는 Git·image에
  포함하지 않고 Vultr instance의 배포 secret로 주입한다.
- PostgreSQL backup은 동일 VM에만 보관하지 않고 별도 장애 영역에 암호화해 보관한다.
  정기 restore drill 전에는 backup 완료로 간주하지 않는다.
- Backend와 Agent의 CPU·memory·p95 latency·queue delay 또는 장애 격리가 기준을 넘으면
  Vultr 내부에서 VM을 분리한다. provider를 다시 분리하는 결정은 측정 결과와 새 ADR을
  요구한다.
- Frontend Vercel 배포 결정은 유지한다. 브라우저는 Vultr의 Spring 공개 API만 호출한다.

## Consequences

### 장점

- 첫 배포의 provider IAM, firewall, 비용 청구와 운영 절차가 단순해진다.
- Spring-Agent 내부 호출의 network latency와 egress 변수를 줄일 수 있다.
- 단일 Compose 기반의 로컬 재현 구조를 초기 staging에 재사용할 수 있다.

### 비용과 위험

- 단일 VM은 compute와 database가 함께 장애 나는 단일 실패 지점이다.
- Agent의 순간 CPU·memory 사용이 Spring과 PostgreSQL에 영향을 줄 수 있다.
- 수직 확장 한계에 도달하면 Vultr 내 다중 VM 또는 managed database로 이동해야 한다.
- 방화벽, resource limit, off-host backup과 restore 검증이 없으면 단일 provider 통합은
  운영 단순화가 아니라 장애 범위 확대로 이어진다.

## 초기 승격 기준

- Agent·PostgreSQL public port 0개
- Spring readiness와 Agent internal health 통과
- Spring → Agent → Spring Tool 실제 서명 token E2E 통과
- PostgreSQL backup 생성과 별도 환경 restore 성공
- 서비스별 memory·CPU limit와 disk 사용량 경보 설정
- immutable image tag 배포와 직전 tag rollback 검증

## Implementation status — 2026-08-14

Production Compose overlay, Caddy TLS ingress, loopback-only Backend bind, 서비스별 resource·PID·read-only filesystem 제한과 immutable GHCR tag 기반 수동 승인 CD를 구현했다. 배포 script는 readiness 실패 시 직전 tag로 rollback한다. PostgreSQL custom dump·SHA-256·암호화된 off-host rclone remote 업로드와 `_restore_drill` 전용 복구 script도 추가했다. 실제 Vultr firewall, domain, secret, backup remote에서의 배포·복구 실행은 외부 환경 확정 후 검증해야 한다.
