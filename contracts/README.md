# Service Contracts

`contracts/`는 Spring Boot와 Python Agent가 공유하는 versioned wire contract의 source of truth다.

## 계약 목록

- `openapi/agent-internal-api.yaml`: Spring Boot가 Agent run을 시작·조회·재개하는 내부 API
- `openapi/spring-tool-api.yaml`: Agent Tool이 Spring Boot의 업무 기능을 호출하는 내부 API

LangChain·LangGraph 객체를 서비스 계약으로 노출하지 않는다. 계약 변경은 backward compatibility를 검토하고 API version을 유지하거나 명시적으로 올린다.

## 보안 원칙

- Docker network는 인증 수단이 아니다.
- Spring과 Agent는 audience가 제한된 짧은 수명의 delegation token을 사용한다.
- Agent는 token에 포함된 workspace와 permission 범위를 넘을 수 없다.
- write Tool은 실행 직전에 Spring에서 현재 권한을 다시 확인한다.

