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

[![Freelance Ops — 문의에서 견적까지](docs/assets/readme/freelance-ops-hero-current.png)](https://d2ol7oe51mr4n9.cloudfront.net/user_3JEFpmzdSjsTLcCF7FlZFREgfCP/720495dd-0b55-4aa9-b73b-35eddfd54a3c.mp4)

**[▶ 제품 데모 보기](https://d2ol7oe51mr4n9.cloudfront.net/user_3JEFpmzdSjsTLcCF7FlZFREgfCP/720495dd-0b55-4aa9-b73b-35eddfd54a3c.mp4)**

## 핵심 기능

| 기능 | 내용 |
| --- | --- |
| 고객·프로젝트 관리 | 고객 맥락과 문의, 일정·예산을 한곳에서 관리 |
| AI 분석 | 요구사항과 근거를 정리하고 필요한 질문은 사용자에게 확인 |
| 세 관점의 AI 동료 | 핵심·권장·확장 견적의 범위와 제안을 비교 |
| 동료 개인화 | 이름·외형·말투·판단 성향을 설정 |
| 견적 검토·공유 | 항목과 근거를 검토하고 견적 발행·고객용 링크 공유 |
| 개인 AI 연결 | OpenAI/Gemini API 키 연결(BYOK) |
| 결과 기록 | 실제 매출·비용·공수를 기록하고 견적과 비교 |

## 문의부터 결과까지

### 1. 고객과 문의 등록

고객 정보와 프로젝트의 요구사항·희망 일정·예산을 연결합니다.

![고객 관리 — 이전 UI](docs/assets/readme/client-profile.gif)

![프로젝트 문의 등록 — 이전 UI](docs/assets/readme/project-intake.gif)

### 2. AI 분석과 사용자 확인

AI 동료가 요구사항과 근거를 정리합니다. 확인이 필요한 내용은 질문하고, 답변을 받은 뒤 분석을 이어갑니다.

![AI 동료와 분석 결과](docs/assets/readme/ai-analysis-current.png)

![사용자 확인과 분석 재개 — 이전 UI](docs/assets/readme/human-review.gif)

### 3. 견적 비교·검토·발행

항목과 예상 금액부터 확인하고, 필요한 상세만 펼칩니다. 세 견적안을 비교하거나 작업을 조합한 뒤 검토한 견적을 발행합니다.

![요약 중심 견적 검토](docs/assets/readme/quote-compact-current.png)

![세 AI 동료의 제안 비교](docs/assets/readme/pet-council-current.png)

### 4. 실제 결과 기록

실제 매출·비용·공수와 예상에서 달라진 이유를 남겨 다음 견적의 참고 자료로 활용합니다.

![프로젝트 결과 기록 — 이전 UI](docs/assets/readme/outcome-review.png)

## 설계 원칙

- AI는 요구사항과 근거를 정리하고, 금액·세금·합계는 서버의 결정적 규칙으로 계산합니다.
- 불확실한 내용은 사용자에게 확인하고, 견적 항목에는 근거 또는 가정을 남깁니다.
- 작업 공간과 사용자 권한으로 데이터 접근을 제한합니다.
- 실행마다 AI 제공사·모델을 기록하고, 개인 API 키는 암호화해 저장합니다.

## 기술 구성

![시스템 아키텍처와 배포 파이프라인](docs/assets/readme/system-architecture-pipeline.png)

| 영역 | 기술 |
| --- | --- |
| Web | Next.js 16, React 19, TypeScript |
| Business API | Java 21, Spring Boot 4, Spring Security, JPA |
| AI Runtime | Python 3.12, FastAPI, LangGraph, OpenAI/Gemini |
| Data | PostgreSQL 17, pgvector |
| Delivery | GitHub Actions, Docker Compose, GHCR, Caddy, Vultr, Vercel |

## 로컬 실행

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

## 문서

- [Backend 실행·검증](backend/README.md) · [Agent 실행·검증](agent/README.md)
- [동료 개인화](docs/frontend/PET_CUSTOMIZATION.md) · [개인 API 키 연결](docs/frontend/BYOK_CONNECTIONS.md)
- [V2 제품·기술 명세](docs/V2_SPECIFICATION.md) · [아키텍처 결정](docs/adr/README.md)
- [AI 신뢰성 사례 연구](docs/portfolio/ai-routing-and-rag-reliability-case-study.md) · [평가·운영 기록](docs/portfolio/README.md)
