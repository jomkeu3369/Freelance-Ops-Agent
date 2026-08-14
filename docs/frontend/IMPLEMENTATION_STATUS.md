# Frontend 구현 상태

> 기준일: 2026-08-14  
> 기준 문서: `MAIN_PAGE_DESIGN_BRIEF.md`, `DESIGN_IMPLEMENTATION_WORKFLOW.md`, `V2_SPECIFICATION.md` §13

## 구현된 범위

| 기준 | 구현 증거 | 상태 |
|---|---|---|
| 메인 페이지 11개 섹션과 지정 문구 | `frontend/app/page.tsx` | 완료 |
| 가짜 후기·고객 로고·통계·가격 제거 | 메인 페이지 source test | 완료 |
| 1920 기준 editorial layout, 1440·1280·1024·768·390 대응 | 로컬 Pretendard dynamic subset, 한글 어절 보존, 1440·1180·820·520 breakpoint와 실제 browser의 Hero 2줄·주요 제목 2–3줄·overflow 0px 측정 | 완료 |
| dark/light theme와 reduced motion | theme provider, `prefers-reduced-motion` | 완료 |
| Home / Pipeline | 실제 Project status 조회·변경 API 기반 6단계 pipeline | 완료 |
| CRM / 고객 연결 | 고객 검색·등록·수정·보관과 새 프로젝트의 기존 고객 연결 | 완료 |
| Workspace 전환 | `/me` membership 기반 기존 Workspace 전환과 workspace-scoped 데이터 재조회 | 완료 |
| Project Intake | 생성 후 고객·원문·통화·일정·예산 수정, stale revision 경고, 텍스트 문서 업로드, 이전 확정본을 이어 편집하는 구조화 기능·가정·질문 immutable revision | 완료 |
| Evidence Library | Workspace 자료 조회·검색·유형 필터, 청크 preview, 업로드·보관 | 완료 |
| 실시간 Agent 진행 | Spring SSE만 구독하는 event-driven graph, Last-Event-ID cursor와 bounded backoff 자동 재연결, 실제 연결 상태·HITL 재개, 실행 중단·재실행, 열린 질문·안전한 출처 provenance·실행 메타데이터, audit 권한 기반 실제 원가·token·credit 표시 | 완료 |
| Quote Builder | Lean·Recommended·Expanded 최신안 비교, Workspace 단가표 또는 직접 단가, 항목별 공수·할인, evidence provenance와 Inspector, assumption, Java 계산 결과, immutable revision | 완료 |
| Proposal Preview | 공개 token 조회, 공유 링크 생성·만료 표시·비활성화, 범위·근거·금액, 승인·수정 요청·거절, browser PDF 출력 | 완료 |
| Outcome Review | 실제 매출·비용·공수·변경 사유와 항목별 실제 결과, 승인 견적 대비 매출·시간 오차 | 완료 |
| Settings의 현재 backend 지원 범위 | `/me`, effective permission, 단가 등록·수정·비활성화·재활성화, estimation policy | 완료 |
| AI 원가 설정 | audit 권한 기반 모델 가격 snapshot 조회, workspace 관리자 등록, 유효 기간 검증 | 완료 |
| Permission-aware UI | effective permission 선조회, 허용된 resource만 요청, 읽기 전용·write·publish·delete action 분리 | 완료 |
| server-state cache | 요청 중복 제거, TTL cache, mutation invalidation | 완료 |
| 인증 수명주기 | sessionStorage, refresh token rotation, browser timer 범위 내 bounded refresh scheduling, server logout | 완료 |
| 근거 프리뷰 상호작용 | 견적 항목 선택 시 계산·가정·연결 source Drawer 동기화 | 완료 |
| 운영 복구와 접근성 | App Router 오류·404 복구, skip link, focus-visible, 제안서 재시도, Clipboard 권한 거부 fallback | 완료 |
| 키보드 작업 수명주기 | 인증 tab 화살표 이동, 현재 위치 전달, modal focus trap·배경 scroll lock·trigger focus 복귀 | 완료 |
| Transactional form UX | 모든 mutation form의 중복 제출 차단, Client·Settings·Outcome pending field lock, modal-local validation·API error, network failure 한국어 복구 | 완료 |
| 작업 맥락 복원 | Workspace 화면·프로젝트·진행 단계를 URL에 기록하고 새로고침·뒤로/앞으로 복원, 잘못된 대상과 권한 없는 화면은 Pipeline으로 정규화 | 완료 |

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
- 실제 browser의 1920·1440·1280·1024·768·390 viewport에서 Pretendard load 완료, Hero 2줄, 주요 제목 2–3줄, horizontal overflow와 console warning·error 0건
- Vercel Preview fixture에서 모든 mutation form의 중복 제출 guard·pending field lock source-contract test 24건, TypeScript, ESLint, Next production build
- Vercel public environment fail-fast test, legacy platform runtime 잔재 검사와 GitHub Node 22 Preview build job
- App Router 복구·접근성·Clipboard fallback source-contract test
- 실제 browser의 1280·1024·390 viewport, Hero line count, horizontal overflow, 인증 tab keyboard와 console log 검사
- API 미기동 인증 요청의 pending lock·unlock, 한국어 network failure와 browser console 검사
- SSE Last-Event-ID source contract와 실행 가능한 cursor monotonicity·1–10초 bounded backoff test
- URL parser·builder 실행 테스트, 허용 목록·프로젝트 존재·permission 기반 deep-link 복원 source contract test
- 단가표의 동일 ID 수정·활성 상태 전환·확인 단계·pending field lock과 Spring PUT 계약 source-contract test
- 1초~2,147,000,000ms session refresh timer 경계값 실행 테스트와 장기 TTL 회원가입 browser 회귀 검증
- 임시 HTTP 계약 서버를 사용한 회원가입→Settings→단가 생성·수정·비활성화·재활성화→새로고침 복원, console warning·error 0건
- 로컬 production server `/`, `/workspace`, `/proposal/[token]` HTTP 200
- production `/workspace?view=project&project=missing&step=quote` 직접 진입의 인증 화면과 browser console warning·error 없음
- Backend 전체 Gradle test

Vercel Project의 Root Directory는 `frontend`이며 Node 22.x, `npm ci`, 표준 Next.js build를 사용한다. Preview에서는 `NEXT_PUBLIC_API_BASE_URL`을 공개 HTTPS Spring URL로 설정하고 branch-specific Preview exact origin을 Spring CORS에 등록해야 한다. 상세 절차는 [`frontend/VERCEL_PREVIEW.md`](../../frontend/VERCEL_PREVIEW.md)에 기록했다.
