# ADR-0017: Spring Backend의 Domain-first 패키지 구조

- 상태: Accepted
- 결정일: 2026-08-13
- 참고: ADR-0011의 JPA 선택과 영속성 규칙은 유지하며, Entity를 `infrastructure`에 둔다는 패키지 위치 결정만 본 ADR로 대체한다.

## 배경

초기 Spring 기반선은 `workspace/application/domain/infrastructure`와
`project/api/application/infrastructure`처럼 도메인마다 서로 다른 패키지 명칭을 사용했다.
기능이 Client, Requirement, Quotation과 Agent Gateway로 확장되면 새 클래스를 어디에 둘지
판단하기 어렵고 DTO가 하나의 `Contracts` 클래스에 중첩되는 문제가 커진다.

기업 포트폴리오와 실제 협업 코드 모두에서 도메인 경계와 일반적인 Spring 계층을 빠르게
파악할 수 있어야 한다. 동시에 workspace RBAC, Agent delegation과 외부 AI runtime 경계처럼
이 프로젝트에만 필요한 구조도 보존해야 한다.

## 결정

- Spring modular monolith의 업무 기능은 `com.freelanceops.backend.domain.{domain}` 아래에 둔다.
- 도메인의 표준 계층은 `client`, `controller`, `dto/request`, `dto/response`, `entity`, `model`, `repository`, `security`, `service`다. 실제 구현에 필요한 계층만 만든다.
- 구현이 없는 계층을 빈 디렉터리나 `package-info.java`로 미리 만들지 않는다.
- 도메인 특성에 따라 `policy` 등 추가 패키지를 둘 수 있다.
- workspace RBAC의 권한 코드와 불변조건은 `workspace.policy`에 둔다.
- Python Agent 연동 DTO와 HTTP adapter는 `agentrun.client`에 두며 LangGraph 구현을 Spring에 포함하지 않는다.
- 인증된 내부 Tool API는 `internaltool` 도메인으로 분리하고 실제 업무 처리는 각 업무 Service를 통해 수행한다.
- 전 도메인 공통 기능만 `global`에 둔다. 현재 범위는 config, health이며 이후 exception, response, observability를 추가할 수 있다.
- API request와 response는 JPA Entity와 분리된 최상위 DTO 파일로 작성한다. 여러 DTO를 `Contracts` 클래스에 중첩하지 않는다.
- Entity와 model은 API·외부 연동 DTO에 의존하지 않는다. 업무 값과 영속 JSON의 타입은 소유 도메인의 model에 두고 DTO와의 변환은 경계에서 수행한다. 타입을 분리할 때 기존 컬럼·JSON 필드·enum·금액 정밀도를 보존하며, 과거 데이터에 현재 HTTP 요청의 검증 상한을 새로 적용하지 않는다. ArchUnit으로 entity·model의 DTO 의존을 금지한다.
- 독립적인 HTTP 요청·응답은 `dto/request`, `dto/response`에 두며 Controller·Service 내부에 선언하지 않는다. 오류 응답과 내부 Tool API에도 같은 기준을 적용한다. 기존 양방향 공통 payload는 `dto`, 외부 Agent 통신 계약은 `client/dto`에 둘 수 있다. 단일 DTO에 종속된 구성요소와 API에 노출하지 않는 서비스 내부 레코드는 별도 파일로 분리하지 않아도 된다.
- 구현체가 하나뿐인 업무 Service에는 형식적인 interface/implementation 쌍을 강제하지 않는다. 외부 연동이나 실제 교체 경계에는 interface를 사용한다.
- 테스트 패키지는 운영 코드 구조를 반영한다.
- ArchUnit으로 Controller의 Repository 직접 접근, 역방향 계층 의존성, DTO 위치와 도메인 순환 참조를 검증한다. 구조 테스트는 각 도메인의 실제 소스가 지원하는 계층에 속하고, 패키지 선언과 파일 경로가 일치하는지 검사한다.
- DTO 이름 검사 외에도 Controller·ControllerAdvice 어노테이션으로 수집한 실제 `@RequestBody`와 endpoint·예외 처리 응답의 정적 타입을 검사한다. 제네릭 컨테이너와 DTO 구성요소를 재귀적으로 검사해 Controller·Service·Entity 타입의 직접 노출을 탐지한다. 기존 운영 정보 응답 `ServiceMetadata`, JDK·프레임워크 타입, 도메인 enum은 허용한다. `Object`·동적 Map·SSE 안의 런타임 객체는 별도 계약 검증 대상이다.

## 영향

2026-10-15 정리: 내용 없는 `package-info.java`는 제거했다. 표준 계층 명칭은 유지하며,
실제 클래스가 필요한 패키지만 만든다. 빈 폴더를 강제하던 구조 테스트는 실제 소스의
계층·DTO 위치·패키지 선언을 검증하도록 변경했다. 계층 의존성과 도메인 순환 참조는
기존 ArchUnit 검사로 검증한다.

장점:

- 기능을 찾을 때 먼저 도메인, 다음으로 Spring 계층을 선택하는 일관된 탐색 경로가 생긴다.
- request, response와 Entity의 경계가 파일 구조에 드러난다.
- RBAC와 Agent 연동의 추가 계층을 일반 CRUD 구조를 훼손하지 않고 표현할 수 있다.
- 구조 규칙이 테스트되므로 이후 기능 추가 과정의 패키지 침식을 조기에 발견한다.

비용과 제약:

- Clean Architecture의 port/adapter 위치가 패키지 이름만으로 완전히 드러나지는 않는다.
- 도메인 간 직접 Service 호출이 늘어나면 순환 참조가 생길 수 있으므로 ArchUnit과 application event를 함께 검토해야 한다.
- `global`을 편의성 패키지로 사용하지 않고 실제 횡단 관심사로 제한해야 한다.
