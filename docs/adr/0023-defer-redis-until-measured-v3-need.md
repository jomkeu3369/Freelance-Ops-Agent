# ADR-0023: Redis를 V2에서 제외하고 측정 기반 V3 결정으로 연기

- 상태: Accepted
- 결정일: 2026-08-14

## Context

V2는 단일 Vultr runtime과 PostgreSQL + pgvector를 기준으로 Spring 업무 데이터와 Python
Agent runtime을 운영한다. Redis를 지금 추가하면 distributed rate limit, event fan-out과 짧은
TTL cache를 제공할 수 있지만 아직 다중 instance, PostgreSQL rate-limit 병목 또는 SSE fan-out
병목이 측정되지 않았다. 검증되지 않은 Redis 도입은 장애 지점, cache invalidation과 운영
복잡성을 늘린다.

## Decision

- Redis는 V2 runtime, Compose와 필수 dependency에 추가하지 않는다.
- 업무 데이터, RBAC, refresh token, 견적, 감사·비용 원장과 Agent checkpoint의 source of truth는
  계속 PostgreSQL이다.
- V2 단일 Backend instance의 admission control은 메모리 bounded fixed-window filter를 사용한다.
  이는 보안의 유일한 경계가 아니며 Agent의 서버측 budget·permission 검사를 대체하지 않는다.
- 신뢰성 있는 비동기 업무 전달은 PostgreSQL transactional outbox로 구현한다.
- SSE polling 병목은 backoff와 PostgreSQL `LISTEN/NOTIFY`를 Redis보다 먼저 검토한다.
- V3에서 다중 Backend instance, DB rate-limit 병목, 대규모 SSE fan-out 또는 짧은 TTL cache의
  반복 조회량이 측정된 경우에만 새 ADR과 benchmark를 거쳐 Redis를 보조 계층으로 도입한다.
- Redis를 도입해도 RBAC나 업무·감사·checkpoint의 원본 저장소로 사용하지 않는다.

## Consequences

- V2의 배포·backup·restore와 장애 대응 대상이 PostgreSQL 중심으로 유지된다.
- 현재 rate limit은 instance-local이므로 Backend를 수평 확장하기 전에 distributed limiter로
  교체해야 한다.
- Redis 도입 여부를 선호가 아니라 동시성, DB 부하, queue delay와 p95 latency로 판단한다.
