<div align="center">

# Freelance Ops Agent

### 작은 AI 동료와 함께, 고객 문의를 근거 있는 견적으로.

고객 관리부터 AI 분석, 견적 검토·발행, 실제 결과 기록까지 이어지는 프리랜서 업무 도구입니다.

[서비스 소개](https://www.freelance-ops.site) · [업무 공간 시작](https://www.freelance-ops.site/workspace) · [기술 포트폴리오](docs/portfolio/README.md)

![Next.js](https://img.shields.io/badge/Next.js_16-000000?style=flat-square&logo=nextdotjs&logoColor=white)
![Spring Boot](https://img.shields.io/badge/Spring_Boot_4-6DB33F?style=flat-square&logo=springboot&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-009688?style=flat-square&logo=fastapi&logoColor=white)
![LangGraph](https://img.shields.io/badge/LangGraph-1C3C3C?style=flat-square)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL_+_pgvector-4169E1?style=flat-square&logo=postgresql&logoColor=white)

</div>

[![Freelance Ops 서비스 소개](docs/assets/readme/landing-overview.png)](https://www.freelance-ops.site)

<sub>서비스 소개 화면</sub>

## 왜 만들었나요?

짧은 고객 문의만으로는 작업 범위나 비용을 바로 정하기 어렵습니다. 요구사항을 정리하고, 빠진 정보를 다시 묻고, 조사 자료와 단가를 연결하는 과정이 필요합니다.

이 과정에서 문의 원문과 판단 근거가 흩어지지 않도록 고객 관리·분석·견적·결과 기록을 하나의 업무 흐름으로 연결했습니다. AI는 초안을 돕고, 최종 범위와 견적 발행은 사용자가 결정합니다.

## 핵심 기능

| 기능 | 내용 |
| --- | --- |
| 고객·프로젝트 관리 | 고객 맥락과 문의, 일정·예산을 한곳에서 관리 |
| AI 분석 | 요구사항과 근거를 정리하고 필요한 질문은 사용자에게 확인 |
| 세 관점의 AI 동료 | 핵심·권장·확장 견적의 범위와 제안을 비교 |
| 동료 개인화 | 이름·외형·말투·판단 성향을 설정 |
| 견적 검토·공유 | 항목과 근거를 검토하고 견적 발행·고객용 링크 공유 |
| 개인 AI 연결 | 개인 API 키 연결(BYOK) |
| 결과 기록 | 실제 매출·비용·공수를 기록하고 견적과 비교 |

## 문의부터 결과까지

1. **고객과 문의 등록:** 고객 정보에 요구사항·희망 일정·예산을 연결합니다.
2. **AI 분석과 사용자 확인:** 요구사항과 근거를 정리하고, 부족한 정보는 질문한 뒤 분석을 이어갑니다.
3. **견적 비교·검토·발행:** 세 견적안의 범위와 금액을 비교하고, 항목별 근거를 검토해 발행합니다.
4. **실제 결과 기록:** 실제 매출·비용·공수와 예상에서 달라진 이유를 남깁니다.

## 주요 화면

### 로그인

![로그인 화면](docs/assets/readme/login-screen.png)

### 대화로 요구사항 검토

문의와 AI 분석 결과를 같은 작업 공간에서 확인합니다. 작성 중인 내용은 대화 하단에 이어집니다.

![대화와 분석 결과](docs/assets/readme/chat-analysis.png)

### 개인 AI 연결

실행 전에 사용할 모델과 개인 키의 예상 비용·실행 한도를 확인합니다. 실제 사용료는 연결한 제공사 계정에 청구됩니다.

![개인 키 비용과 실행 한도 안내](docs/assets/readme/personal-key-cost-notice.png)

### 나만의 AI 동료

원하는 말투·판단 성향을 입력하고, 무료 미리보기에서 해석된 설정을 확인합니다.

<img src="docs/assets/readme/custom-pets.png" alt="AI 동료 설정 미리보기" width="390" />

<sub>채팅·개인 키·AI 동료 화면은 예시 데이터로 촬영했습니다.</sub>

## 작동 방식과 기술 파이프라인

1. **입력과 업무 데이터:** Next.js에서 받은 고객·문의 정보를 Spring이 인증·권한 검사 후 저장합니다.
2. **AI 분석:** FastAPI·LangGraph가 요구사항, 조사, 견적 범위와 근거를 정리합니다. 업무 데이터는 권한이 제한된 Spring 내부 API를 통해 조회합니다.
3. **사용자 확인:** 불확실한 내용은 질문으로 남기고, 답변을 받으면 저장된 실행 상태에서 분석을 이어갑니다.
4. **계산과 발행:** 금액·세금·합계는 Spring의 정해진 규칙으로 계산합니다. 사용자가 검토한 견적을 발행하고, 개정·발행 이력과 실제 결과를 기록합니다.

![시스템 아키텍처와 배포 파이프라인](docs/assets/readme/system-architecture-pipeline.png)

### 이 기술을 선택한 이유

| 영역 | 기술 | 선택 이유 |
| --- | --- | --- |
| Web | Next.js 16, React 19, TypeScript | 공개 소개와 로그인 이후 업무 공간을 한 프론트엔드에서 구성 |
| Business API | Java 21, Spring Boot 4, Spring Security, JPA | 인증·권한·거래 데이터를 한곳에서 관리하고 견적 금액을 정해진 규칙으로 계산 |
| AI Runtime | Python 3.12, FastAPI, LangGraph | 모델·검색 도구를 연결하고, 사용자 확인으로 멈춘 분석을 저장된 상태에서 재개 |
| Data | PostgreSQL 17, pgvector | 업무 데이터와 검색 근거에 같은 권한·참조 규칙을 적용하고 저장소 운영을 단순화 |
| Delivery | GitHub Actions, Docker Compose, GHCR, Caddy, Vultr, Vercel | 테스트를 통과한 변경을 서비스별로 검증하고 배포 |

서비스를 나눈 대신 내부 인증과 API 계약을 별도로 관리합니다. 자세한 판단과 대안은 [서비스 경계](docs/adr/0001-spring-python-service-boundary.md), [저장소 선택](docs/adr/0002-postgresql-pgvector.md), [견적 계산·이력](docs/adr/0019-immutable-grounded-quotation.md)에 정리했습니다.

<details>
<summary>로컬에서 실행하기</summary>

Docker Compose와 Node.js 22가 필요합니다. [.env.example](.env.example)과 [frontend/.env.example](frontend/.env.example)을 각각 `.env`, `frontend/.env.local`로 복사하고 환경 변수를 설정합니다.

```bash
docker compose -f docker-compose-infra.yaml up -d --wait
docker compose -f docker-compose.yaml up --build -d --wait
```

별도 터미널에서 프론트엔드를 실행하고 `http://localhost:3000`에 접속합니다.

```bash
cd frontend
npm ci
npm run dev
```

</details>

## 트러블슈팅

- **로컬 API가 연결되지 않을 때:** 두 Compose 구성이 정상 실행 중인지, 프론트엔드 API 주소가 `frontend/.env.example`과 맞는지 확인합니다.
- **Swagger에서 인증 오류가 날 때:** 로그인으로 발급한 access token을 `Authorize`에 입력합니다. [인증·권한 안내](backend/README.md#user-authentication)
- **분석이 중단됐을 때:** 표시된 오류와 실행 한도를 먼저 확인합니다. 개인 키 실행의 한도는 재개해도 초기화되지 않습니다. [실행 한도 설명](agent/README.md#bounded-personal-key-execution)

## 문서

- [Backend 실행·검증](backend/README.md) · [Agent 실행·검증](agent/README.md)
- [동료 개인화](docs/frontend/PET_CUSTOMIZATION.md) · [개인 API 키 연결](docs/frontend/BYOK_CONNECTIONS.md)
- [V2 제품·기술 명세](docs/V2_SPECIFICATION.md) · [아키텍처 결정](docs/adr/README.md)
- [AI 신뢰성 사례 연구](docs/portfolio/ai-routing-and-rag-reliability-case-study.md) · [기술 포트폴리오](docs/portfolio/README.md)
