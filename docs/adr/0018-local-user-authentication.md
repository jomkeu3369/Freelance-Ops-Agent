# ADR-0018: Spring 소유 로컬 사용자 인증과 Refresh Token 회전

- 상태: Accepted
- 결정일: 2026-08-13

## Context

기존 Spring Security 기반선은 개발용 HTTP Basic 사용자만 제공했다. 반면 공개 Controller는 인증 principal 이름을 UUID 사용자 ID로 사용하고 있었으므로 실제 로그인 사용자와 workspace RBAC를 안전하게 연결할 수 없었다. V2는 Spring이 인증과 업무 트랜잭션을 소유하고 브라우저가 Spring 공개 API만 호출한다는 경계를 유지해야 한다.

초기 서비스에는 외부 Identity Provider를 운영할 필요가 없지만, 이후 OAuth/OIDC로 교체할 수 있도록 업무 도메인과 token 구현을 분리해야 한다. 탈취된 장기 token의 재사용 범위를 줄이고 DB 유출 시 session 원문이 노출되지 않도록 해야 한다.

## Decision

- Spring의 `identity` 도메인이 이메일 계정, 비밀번호 검증과 사용자 session을 소유한다.
- 비밀번호는 BCrypt strength 12로 단방향 hash한다. 로그인 시 존재하지 않는 이메일에도 dummy hash 검증을 수행해 응답 시간 차이를 줄인다.
- access token은 HS256 JWT이며 UUID 사용자 ID를 `sub`에 기록한다. issuer, audience, 만료와 `token_type=access`를 모두 검증한다.
- access token 기본 수명은 15분이다. 서명 secret은 운영 환경에서 32바이트 이상이어야 하고 기본 개발 secret을 운영에서 허용하지 않는다.
- refresh token은 암호학적 난수 기반 opaque token으로 발급하고 DB에는 SHA-256 hash만 저장한다.
- refresh 요청은 row lock 안에서 기존 token을 폐기하고 새 token pair로 일회 회전한다. 만료·폐기된 token은 재사용할 수 없다.
- 회원가입은 사용자와 첫 workspace, OWNER membership과 기본 role matrix를 하나의 transaction에서 생성한다.
- 인증 공개 endpoint는 register, login, refresh, logout으로 제한한다. 나머지 공개 업무 API는 Bearer access token을 요구한다.
- Agent delegation token은 사용자 access token과 key, audience, filter를 분리한다. 브라우저가 delegation token을 받거나 Agent API를 직접 호출하지 않는다.
- 비공개 chain-of-thought나 인증 token 원문을 audit log에 저장하지 않는다.

## Consequences

장점:

- 인증 principal의 UUID와 `user_account`·workspace RBAC가 일관되게 연결된다.
- refresh token 원문 DB 저장을 피하고 회전으로 장기 token 재사용 위험을 줄인다.
- 브라우저 인증과 Spring↔Agent 위임 인증의 신뢰 경계가 명확히 분리된다.
- 향후 OIDC 도입 시 Controller와 RBAC 계약을 유지하면서 인증 발급부를 교체할 수 있다.

비용과 제약:

- HS256 secret 회전과 다중 key 운영은 아직 구현하지 않았다. 공개 운영 전 key rotation 절차가 필요하다.
- 전체 session 일괄 폐기, 비밀번호 재설정, 이메일 검증과 brute-force rate limit은 후속 구현이 필요하다.
- refresh token을 응답 body로 반환하므로 frontend는 localStorage가 아닌 제한된 메모리 또는 Secure·HttpOnly cookie 전략을 별도로 확정해야 한다.
