# ADR-0026: 정책 기반 AI Gateway와 평가 승격 Gate

- 상태: Accepted
- 결정일: 2026-08-15

## Context

Agent runtime에는 provider 선택, retry, run budget, 비용 원장과 LangSmith trace가 있었지만 모델 호출을 공통으로 통제하는 admission 계층은 없었다. 모델 후보 실험도 문서화되어 있었으나 배포 workflow가 고정 평가 결과의 회귀를 자동 차단하지 않았다.

초기 운영 서버는 1 vCPU·2GB RAM이므로 무제한 동시 모델 호출은 event loop, DB connection과 provider quota를 함께 압박할 수 있다. 반대로 Redis·Kubernetes를 먼저 도입하면 측정되지 않은 복잡도만 늘어난다.

## Decision

- Python Agent 내부에 `AIGateway`를 두고 부서 생성과 ReAct 모델 호출이 이 계층을 통과하게 한다.
- Gateway는 model allowlist, 동시 실행 제한, bounded admission wait, provider/model별 circuit breaker를 적용한다.
- provider와 model은 Spring 요청에서 명시한 값을 유지하며 조용한 fallback을 하지 않는다.
- workspace별 run·token·Tool quota와 비용 원장은 Spring이 계속 소유한다. Gateway는 이를 대체하지 않는다.
- Gateway telemetry에는 prompt, 응답, credential과 사용자 식별자를 넣지 않고 호출 결과·latency·token 합계만 보존한다.
- metrics endpoint는 기본 비활성화하고 별도 bearer token과 Docker internal network를 함께 요구한다. Caddy로 공개하지 않는다.
- versioned model registry에 모델별 `APPROVED`, `SHADOW_ONLY`, `SIGNAL_ONLY` 상태와 허용 용도·근거를 기록한다.
- 기존 frozen report와 registry의 승인 candidate를 pin한 release policy를 Agent CI에서 실행한다. 이 gate는 승인 후보의 회귀 방지 기준이다.
- 새로운 local model의 운영 승격에는 ADR-0015의 route별 F1, `HUMAN_REQUIRED` recall, false automation과 shadow 조건을 별도로 적용한다.
- semantic response cache는 고객 데이터 혼입과 권한 경계 재사용 위험 때문에 도입하지 않는다.
- Redis와 Kubernetes는 실제 단일 instance 한계가 측정된 뒤 별도 ADR로 재검토한다.

## Consequences

### 장점

- provider 장애와 트래픽 급증이 무제한 동시 호출로 번지는 것을 막는다.
- 모델 선택이 코드와 배포 환경의 allowlist로 검증된다.
- 평가 artifact, release policy와 CI 결과가 배포 결정으로 연결된다.
- prompt를 수집하지 않고도 p50·p95, token, 실패와 거절 추이를 볼 수 있다.

### 비용과 한계

- 현재 circuit state와 latency sample은 process memory에 있으므로 재시작 시 초기화된다.
- 단일 instance admission이며 분산 quota가 아니다.
- 현재 release gate는 50건 frozen routing set의 회귀를 막을 뿐 실제 사용자 분포의 품질을 보장하지 않는다.
- 운영 SLO 달성 여부는 k6와 실제 trace를 수집한 뒤 확정해야 한다.
