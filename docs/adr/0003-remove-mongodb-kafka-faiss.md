# ADR-0003: MongoDB, Kafka, 운영 FAISS 제거

- 상태: Accepted
- 결정일: 2026-07-20

## Context

MongoDB는 CRM과 로그 저장에 사용되고, FAISS는 별도 vector index로 유지된다. Kafka는 주로 로그인 이벤트와 로그 전달에 사용된다. 현재 규모에서는 각 기술의 운영 비용에 비해 독립 확장, 다중 consumer, 높은 event 처리량 같은 이점이 입증되지 않았다.

## Decision

- MongoDB와 Beanie를 V2 운영 구성에서 제거한다.
- Kafka, worker와 Kafka logging handler를 제거한다.
- 운영 retrieval에서 FAISS를 제거한다.
- application log는 stdout과 observability pipeline으로 처리한다.
- 변경 감사는 PostgreSQL audit event로 저장한다.
- 비동기 신뢰성이 필요한 업무 event는 먼저 transactional outbox로 구현한다.
- FAISS는 pgvector와 비교하는 오프라인 evaluation baseline에서만 유지할 수 있다.

## Consequences

- Docker Compose와 장애 지점이 단순해진다.
- database migration이 필요하다.
- Kafka 재도입은 실제 throughput, consumer 독립성 또는 delivery 요구를 측정한 새 ADR이 있어야 한다.
