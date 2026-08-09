# ADR-0011: Spring Data JPA 기반 업무 데이터 영속화

- 상태: Accepted
- 결정일: 2026-08-09

## Context

초기 Spring Boot 기반선은 `JdbcClient`와 애플리케이션 코드에 작성한 SQL로 워크스페이스 생성, RBAC 권한 조회, 감사 이벤트 저장을 구현했다. 작은 기반선을 빠르게 검증하는 데는 유효했지만, 도메인이 Client·Project·Quotation으로 확대되면 SQL 매핑과 변경 추적 비용이 커지고 영속성 세부 사항이 application 계층으로 누출된다.

동시에 workspace 격리와 cross-workspace 역할 할당 차단은 ORM 편의 기능만으로 보장할 수 없다. DB 복합 외래키와 명시적인 `workspace_id` 조회 조건도 유지해야 한다.

## Decision

- Spring 업무 데이터의 기본 영속성 기술로 Spring Data JPA와 Hibernate를 사용한다.
- application service는 `JdbcClient`, SQL 또는 JPA `EntityManager`를 직접 사용하지 않고 Repository를 의존한다.
- JPA entity는 API DTO로 노출하지 않으며 infrastructure 계층에 둔다.
- 모든 workspace 소유 Repository 조회에는 `workspaceId`를 메서드 조건으로 포함한다.
- 역할·권한 연결 테이블의 복합키와 `workspace_id` 복합 외래키는 유지한다.
- Flyway를 schema의 유일한 변경 수단으로 사용하고 Hibernate는 `ddl-auto=validate`만 사용한다.
- Flyway migration, DB 고유 제약 검증, 성능상 근거가 있는 복잡한 조회에는 SQL을 허용한다. 예외적인 native query는 근거와 테스트를 함께 기록한다.
- 연관관계는 필요한 방향에만 추가하고, 무제한 양방향 관계와 무분별한 cascade를 사용하지 않는다.

## Consequences

### 장점

- CRUD와 변경 감지 코드가 줄고 도메인 확장 시 반복 SQL 작성 비용이 감소한다.
- Repository 계약을 통해 application 계층과 PostgreSQL 구현을 분리할 수 있다.
- Flyway와 Hibernate schema validation의 조합으로 migration과 entity 불일치를 조기에 발견한다.

### 비용과 제약

- N+1 조회, 영속성 컨텍스트, flush 순서와 lazy loading을 이해하고 측정해야 한다.
- workspace 격리는 자동으로 생기지 않으므로 Repository API와 DB 제약에서 계속 강제해야 한다.
- 대량 처리와 복잡한 통계 조회는 JPA만 고집하지 않고 benchmark 후 별도 read model 또는 명시적 SQL을 검토한다.
