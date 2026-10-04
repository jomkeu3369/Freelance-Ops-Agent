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

[![Freelance Ops — 2026-10-04 운영 랜딩](docs/assets/readme/landing-production-2026-10-04.jpg)](https://www.freelance-ops.site)

2026-10-04 실제 운영 소개 페이지 캡처 · `d1c5f2d`. 화면 속 문의·금액은 가상 제품 예시이며 실제 분석·저장·발송을 실행하지 않습니다.

<details>
<summary>새 언어 메뉴와 좁은 화면 보기</summary>

![라벤더 언어 메뉴](docs/assets/readme/landing-language-2026-10-04.jpg)

<img src="docs/assets/readme/landing-responsive-narrow-2026-10-04.jpg" alt="브라우저 확대를 이용한 466px 좁은 반응형 화면" width="280">

좁은 화면은 데스크톱 브라우저 확대를 이용한 반응형 캡처입니다. 실제 모바일 기기 검증 자료는 아닙니다.

</details>

**[▶ 2026-09-12 제품 UI 데모 보기](https://d2ol7oe51mr4n9.cloudfront.net/user_3JEFpmzdSjsTLcCF7FlZFREgfCP/720495dd-0b55-4aa9-b73b-35eddfd54a3c.mp4)**

아래 업무 화면 GIF·영상은 2026-09-12 버전에 합성 데이터를 연결한 UI 시연입니다. 새 업무 공간 개편의 화면이나 실제 고객·모델 실행의 검증 자료로 사용하지 않습니다.

## 현재 상태

2026-10-04 기준, 운영 중인 기능과 작업 브랜치의 변경을 구분합니다.

| 구분 | 상태 |
| --- | --- |
| 운영 버전 | 고객·프로젝트, 분석, 견적 검토·발행·공유와 결과 기록을 제공하는 pilot. 실제 사용자 성과와 장기 운영 적합성은 검증 중 |
| 소개 페이지 개편 | 새 랜딩, 전체 폭 헤더와 언어 메뉴를 별도 배포. 업무 공간·백엔드는 이 배포에서 변경하지 않음 |
| 업무 공간 개편 | 채팅 중심 화면, 관찰된 실행 상태 표시와 인증 오류 안내를 작업 브랜치에서 구현·검증 중 |
| 프로젝트 보드 | 카드 드래그 이동을 별도 작업 브랜치와 preview에 구현. 실제 브라우저 상호작용 검수와 운영 배포 전 단계 |
| 사용량·가입·운영 기능 | 계정별 월간 무료 분석 제한, 가입 확인, 이메일 검증·공지 기반 코드는 배포 전 검증 중. 실제 이메일 전송은 활성화하지 않음 |
| AI 제공사 변경 | OpenAI 전용 전환을 작업 브랜치에 구현. Gemini 제거는 프론트엔드·백엔드·Agent의 통합 배포 전 단계 |

[버전별 근거와 미디어 기준](docs/portfolio/product-evidence.md)

## 핵심 기능

| 기능 | 내용 |
| --- | --- |
| 고객·프로젝트 관리 | 고객 맥락과 문의, 일정·예산을 한곳에서 관리 |
| AI 분석 | 요구사항과 근거를 정리하고 필요한 질문은 사용자에게 확인 |
| 세 관점의 AI 동료 | 핵심·권장·확장 견적의 범위와 제안을 비교 |
| 동료 개인화 | 이름·외형·말투·판단 성향을 설정 |
| 견적 검토·공유 | 항목과 근거를 검토하고 견적 발행·고객용 링크 공유 |
| 개인 AI 연결 | 운영 버전의 OpenAI/Gemini API 키 연결(BYOK). OpenAI 전용 전환은 배포 전 검증 중 |
| 결과 기록 | 실제 매출·비용·공수를 기록하고 견적과 비교 |

## 문의부터 결과까지

아래는 2026-09-12 제품 흐름을 보여주는 합성 데이터 시연입니다.

### 1. 고객과 문의 등록

고객 정보와 프로젝트의 요구사항·희망 일정·예산을 연결합니다.

![고객 관리](docs/assets/readme/client-profile-current.gif)

![프로젝트 문의 등록](docs/assets/readme/project-intake-current.gif)

### 2. AI 분석과 사용자 확인

AI 동료가 요구사항과 근거를 정리합니다. 확인이 필요한 내용은 질문하고, 답변을 받은 뒤 분석을 이어갑니다.

![AI 동료와 분석 결과](docs/assets/readme/ai-analysis-current.gif)

![사용자 확인과 분석 재개](docs/assets/readme/human-review-current.gif)

### 3. 견적 비교·검토·발행

항목과 예상 금액부터 확인하고, 필요한 상세만 펼칩니다. 세 견적안을 비교하거나 작업을 조합한 뒤 검토한 견적을 발행합니다.

![요약 중심 견적 검토](docs/assets/readme/quote-review-current.gif)

![세 AI 동료의 제안 비교](docs/assets/readme/pet-council-current.gif)

### 4. 실제 결과 기록

실제 매출·비용·공수와 예상에서 달라진 이유를 남겨 다음 견적의 참고 자료로 활용합니다.

![프로젝트 결과 기록](docs/assets/readme/outcome-review-current.gif)

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
| AI Runtime | Python 3.12, FastAPI, LangGraph. 운영 버전은 OpenAI/Gemini, 작업 브랜치는 OpenAI 전용 |
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
