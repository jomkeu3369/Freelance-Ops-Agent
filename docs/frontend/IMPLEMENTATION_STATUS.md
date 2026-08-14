# Frontend 구현 상태

> 기준일: 2026-08-14  
> 기준 문서: `MAIN_PAGE_DESIGN_BRIEF.md`, `DESIGN_IMPLEMENTATION_WORKFLOW.md`, `V2_SPECIFICATION.md` §13

## 구현된 범위

| 기준 | 구현 증거 | 상태 |
|---|---|---|
| 메인 페이지 11개 섹션과 지정 문구 | `frontend/app/page.tsx` | 완료 |
| 가짜 후기·고객 로고·통계·가격 제거 | 메인 페이지 source test | 완료 |
| 1920 기준 editorial layout, 1440·1024·768·390 대응 | `frontend/app/globals.css`의 1180·820·520 breakpoint | 완료 |
| dark/light theme와 reduced motion | theme provider, `prefers-reduced-motion` | 완료 |
| Home / Pipeline | 실제 Project status 조회·변경 API 기반 6단계 pipeline | 완료 |
| CRM / 고객 연결 | 고객 검색·등록·수정·보관과 새 프로젝트의 기존 고객 연결 | 완료 |
| Workspace 전환 | `/me` membership 기반 기존 Workspace 전환과 workspace-scoped 데이터 재조회 | 완료 |
| Project Intake | 생성 후 고객·원문·통화·일정·예산 수정, stale revision 경고, 텍스트 문서 업로드, 이전 확정본을 이어 편집하는 구조화 기능·가정·질문 immutable revision | 완료 |
| Evidence Library | Workspace 자료 조회·검색·유형 필터, 청크 preview, 업로드·보관 | 완료 |
| 실시간 Agent 진행 | Spring SSE만 구독하는 event-driven graph, HITL 재연결, 실행 중단·재실행, 열린 질문·안전한 출처 provenance·실행 메타데이터, audit 권한 기반 실제 원가·token·credit 표시 | 완료 |
| Quote Builder | Lean·Recommended·Expanded 최신안 비교, Workspace 단가표 또는 직접 단가, 항목별 공수·할인, evidence provenance와 Inspector, assumption, Java 계산 결과, immutable revision | 완료 |
| Proposal Preview | 공개 token 조회, 공유 링크 생성·만료 표시·비활성화, 범위·근거·금액, 승인·수정 요청·거절, browser PDF 출력 | 완료 |
| Outcome Review | 실제 매출·비용·공수·변경 사유와 항목별 실제 결과, 승인 견적 대비 매출·시간 오차 | 완료 |
| Settings의 현재 backend 지원 범위 | `/me`, effective permission, rate card, estimation policy | 완료 |
| AI 원가 설정 | audit 권한 기반 모델 가격 snapshot 조회, workspace 관리자 등록, 유효 기간 검증 | 완료 |
| Permission-aware UI | effective permission 선조회, 허용된 resource만 요청, 읽기 전용·write·publish·delete action 분리 | 완료 |
| server-state cache | 요청 중복 제거, TTL cache, mutation invalidation | 완료 |
| 인증 수명주기 | sessionStorage, refresh token rotation, server logout | 완료 |
| 근거 프리뷰 상호작용 | 견적 항목 선택 시 계산·가정·연결 source Drawer 동기화 | 완료 |

## Backend 계약이 없어 보류된 항목

아래 항목은 화면만 임의 저장하면 실제 API 기반이라는 제품 원칙을 위반하므로 fake local state로 구현하지 않았다.

- 직무, 주당 가용 시간, 기본 국가·관할권과 거래 유형을 저장하는 workspace profile API
- 멤버 초대, role 변경과 custom role 관리 API
- LLM 전송·trace privacy 설정 API
- 데이터 export·workspace 삭제 API
- 요금제, 남은 Agent·검색 credit의 workspace 집계 API
- 견적의 제외 범위·지급 조건을 영속화하는 quotation contract
- PDF binary 생성 API. 현재는 고객 제안서의 print stylesheet와 브라우저 PDF 저장을 제공한다.

## 검증 기준

- `npm.cmd test`
- `npm.cmd run typecheck`
- `npm.cmd run lint`
- `npm.cmd run build` (`next build`)
- 로컬 production server `/`, `/workspace` HTTP 200
- Backend 전체 Gradle test

Vercel Project의 Root Directory는 `frontend`이며 Node 22.x, `npm ci`, 표준 Next.js build를 사용한다. Preview에서는 `NEXT_PUBLIC_API_BASE_URL`을 공개 HTTPS Spring URL로 설정하고 branch-specific Preview exact origin을 Spring CORS에 등록해야 한다. 상세 절차는 [`frontend/VERCEL_PREVIEW.md`](../../frontend/VERCEL_PREVIEW.md)에 기록했다.
