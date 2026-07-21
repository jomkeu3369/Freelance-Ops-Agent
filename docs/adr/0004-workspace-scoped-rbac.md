# ADR-0004: Workspace-scoped RBAC

- 상태: Accepted
- 결정일: 2026-07-20

## Context

V1은 인증된 사용자가 모든 CRM record와 임의의 Agent thread에 접근할 수 있어 여러 프리랜서가 안전하게 사용하는 제품이 될 수 없다. 단순한 `is_admin`이나 전역 role은 workspace별 팀 구성을 표현하지 못한다.

## Decision

- RBAC role은 `workspace_member`에 부여한다.
- 기본 role은 `OWNER`, `ADMIN`, `MANAGER`, `ESTIMATOR`, `VIEWER`다.
- controller와 application service는 role 문자열이 아니라 permission code를 검사한다.
- 모든 사용자 소유 query와 vector 검색에는 별도로 `workspace_id`를 적용한다.
- deny by default를 사용한다.
- 마지막 Owner 제거, 자기 권한 상승과 ADMIN의 OWNER 변경을 domain rule로 차단한다.
- Agent와 Tool은 실행 사용자의 위임된 permission을 넘을 수 없다.
- role과 permission 변경은 audit event로 기록한다.

## Consequences

- 동일 사용자가 workspace마다 다른 역할을 가질 수 있다.
- permission matrix와 cross-tenant test가 필수 품질 게이트가 된다.
- 향후 project assignment가 필요하면 RBAC와 분리된 resource scope ADR로 확장한다.
