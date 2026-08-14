# Frontend 구현 상태

> 기준일: 2026-08-14  
> 기준 문서: `MAIN_PAGE_DESIGN_BRIEF.md`, `DESIGN_IMPLEMENTATION_WORKFLOW.md`, `V2_SPECIFICATION.md` §13

## 구현된 범위

| 기준 | 구현 증거 | 상태 |
|---|---|---|
| 메인 페이지 11개 섹션과 지정 문구 | `frontend/app/page.tsx` | 완료 |
| 가짜 후기·고객 로고·통계·가격 제거 | 메인 페이지 source test | 완료 |
| 1920 기준 editorial layout, 1440·1280·1024·768·390 대응 | 로컬 Pretendard dynamic subset, 한글 어절 보존, 1440·1180·820·520 breakpoint와 실제 browser의 Hero 2줄·주요 제목 2–3줄·overflow 0px 측정 | 완료 |
| 업무 단계 아코디언 타이포그래피 | 접힌 한글 제목은 `vertical-rl`·`upright`로 정방향 표시하고 활성 제목은 가로쓰기, 180도 중복 회전 방지 회귀 검사 | 완료 |
| 업무 단계 작동 방식 시각화 | 5개 활성 단계마다 입력→처리→결과가 달라지는 코드 기반 미니 그래프, 이동 packet·처리 궤도, 820px 이하 compact layout | 완료 |
| dark/light theme와 reduced motion | theme provider, `prefers-reduced-motion` | 완료 |
| Home / Pipeline | 실제 Project status 조회·변경 API 기반 6단계 pipeline | 완료 |
| Pipeline 상태 정확성 | 협상 열에 함께 표시되는 `ACCEPTED`도 select가 실제 server status를 유지하고 `고객 승인됨`으로 구분 | 완료 |
| CRM / 고객 연결 | 고객 검색·등록·수정·보관과 새 프로젝트의 기존 고객 연결 | 완료 |
| Workspace 전환 | `/me` membership 기반 기존 Workspace 전환과 workspace-scoped 데이터 재조회 | 완료 |
| 신규 Workspace 온보딩 | 회원가입 후 설정 자동 진입, 실제 `/me`·단가·견적 정책·프로젝트 데이터 기반 4단계 진행률, 단계별 설정/첫 문의 CTA와 완료 후 Pipeline 연결 | 완료 |
| Project Intake | 생성 후 고객·원문·통화·일정·예산 수정, 텍스트 문서 업로드, 이전 확정본을 이어 편집하는 구조화 기능·가정·질문 immutable revision, 현재 원문↔확정 sourceText 동기화 상태와 실제 추가·삭제 diff | 완료 |
| Evidence Library | Workspace 자료 조회·검색·유형 필터, 청크 preview, 업로드·보관 | 완료 |
| 실시간 Agent 진행 | Spring SSE만 구독하는 event-driven graph, 실제 활성 연결선만 이동하는 packet·접근 가능한 진행률·대기/응답대기/완료/실패/취소 상태, Last-Event-ID cursor와 bounded backoff 자동 재연결, HITL 재개·실행 중단·재실행, 열린 질문·안전한 출처 provenance·실행 메타데이터, audit 권한 기반 실제 원가·token·credit 표시 | 완료 |
| HITL 답변 복구 | 사용자·Workspace·run·interruption별 versioned 현재 탭 임시저장, 24시간·질문 일치 검증, 단계 전환 복원, 제출 성공 시 삭제·실패 시 보존 | 완료 |
| Quote Builder | Lean·Recommended·Expanded 최신안 비교, Workspace 단가표 또는 직접 단가, 항목별 공수·할인, evidence provenance와 Inspector, assumption, Java 계산 결과, immutable revision | 완료 |
| 견적 편집 복구 | 사용자·Workspace·프로젝트별 versioned 현재 탭 임시저장, 450ms debounce, 7일 유효성 검증, 복원·폐기 상태 안내, 서버 revision 전환과 이탈 보호 | 완료 |
| Proposal Preview | 공개 token 조회, 공유 링크 생성·만료 표시·비활성화, 범위·근거·금액, 승인·수정 요청·거절, browser PDF 출력 | 완료 |
| Outcome Review | 실제 매출·비용·공수·변경 사유와 항목별 실제 결과, 승인 견적 대비 매출·시간 오차 | 완료 |
| Settings의 현재 backend 지원 범위 | `/me`, effective permission, 단가 등록·수정·비활성화·재활성화, estimation policy | 완료 |
| AI 원가 설정 | audit 권한 기반 모델 가격 snapshot 조회, workspace 관리자 등록, 유효 기간 검증 | 완료 |
| Permission-aware UI | effective permission 선조회, 허용된 resource만 요청, 읽기 전용·write·publish·delete action 분리 | 완료 |
| server-state cache | 요청 중복 제거, TTL cache, mutation invalidation | 완료 |
| 인증 수명주기 | sessionStorage, refresh token rotation, browser timer 범위 내 bounded refresh scheduling, server logout | 완료 |
| 인증 진입 UX | 회원가입 비밀번호 확인·일치 검증, 접근 가능한 비밀번호 표시/숨기기, 모드 전환 오류 초기화, pending 중 fieldset·인증 탭 잠금, 수축 가능한 2열 grid와 한글 어절 보존·반응형 제목 | 완료 |
| 근거 프리뷰 상호작용 | 견적 항목 선택 시 계산·가정·연결 source Drawer 동기화 | 완료 |
| 운영 복구와 접근성 | App Router 오류·404 복구, skip link, focus-visible, 제안서 재시도, Clipboard 권한 거부 fallback | 완료 |
| 키보드 작업 수명주기 | 인증 tab 화살표 이동, 현재 위치 전달, modal focus trap·배경 scroll lock·trigger focus 복귀 | 완료 |
| Transactional form UX | 모든 mutation form의 중복 제출 차단, Client·Settings·Outcome pending field lock, modal-local validation·API error, network failure 한국어 복구 | 완료 |
| 작업 맥락 복원 | Workspace 화면·프로젝트·진행 단계를 URL에 기록하고 새로고침·뒤로/앞으로 복원, 잘못된 대상과 권한 없는 화면은 Pipeline으로 정규화 | 완료 |
| 모바일 Workspace 탐색 | 820px 이하 sticky 4열 핵심 메뉴, 네이티브 프로젝트 선택기와 새 프로젝트 진입, 데스크톱 프로젝트 목록 가로 스크롤 제거 | 완료 |

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
- 실제 browser computed style에서 접힌 업무 단계 제목 4개의 `transform: none`·`writing-mode: vertical-rl`·`text-orientation: upright`와 활성 제목의 가로쓰기 확인
- 실제 browser에서 업무 단계 미니 그래프 397×190px·노드 4개·moving packet 2개, 4단계 전환 후 중심 노드 `결정적 계산`, horizontal overflow와 console warning·error 0건 확인
- 회원가입 비밀번호 불일치 시 API 요청 0건·확인 필드 focus, 모드 전환 시 오류/노출 상태 초기화, pending 중 fieldset·인증 탭 잠금, 로그인 성공 후 Pipeline 진입을 실제 browser에서 확인
- 1280×720 실제 browser에서 인증 제목 3줄·`작업으로.` 어절 유지, 672px/608px grid, 520px 로그인 panel 전체 노출, horizontal overflow와 console warning·error 0건 확인
- 실제 browser의 Project Intake에서 stale 원문의 `재검토 필요`, 기능 2·가정 1·질문 1 요약, 확정 원문 대비 삭제 없음·추가 문장 diff, 열린 상세와 815px 비교 영역, horizontal overflow와 console warning·error 0건 확인
- 임시 Spring 계약 서버와 1280px 실제 browser에서 `ACCEPTED` 선택값 `고객 승인됨`, HITL 답변 작성→문의→AI 분석 복원, 503 제출 실패 후 답변·오류 동시 보존, horizontal overflow 0px 확인
- 임시 Spring 계약 서버와 실제 browser에서 신규 회원가입→`?view=settings` 자동 진입, 실제 서버 상태 기반 3/4·75% 온보딩, 완료/현재 단계 구분, 첫 문의 대화상자 진입, horizontal overflow와 console warning·error 0건 확인
- Vercel Preview fixture에서 모든 mutation form의 중복 제출 guard·pending field lock source-contract test 24건, TypeScript, ESLint, Next production build
- 견적 draft의 사용자·Workspace·프로젝트 scope, schema·만료 검증과 Quote Builder 연결을 포함한 Node 테스트 27건, 실제 browser의 입력→저장→화면 이동→복원→확인 후 폐기, 1280px horizontal overflow 0px
- Vercel public environment fail-fast test, legacy platform runtime 잔재 검사와 GitHub Node 22 Preview build job
- App Router 복구·접근성·Clipboard fallback source-contract test
- 실제 browser의 1280·1024·390 viewport, Hero line count, horizontal overflow, 인증 tab keyboard와 console log 검사
- API 미기동 인증 요청의 pending lock·unlock, 한국어 network failure와 browser console 검사
- SSE Last-Event-ID source contract와 실행 가능한 cursor monotonicity·1–10초 bounded backoff test
- 실제 browser의 Agent 흐름 미리보기에서 활성 연결선 1개·moving packet 1개·대기 연결선 packet 0개, 진행률과 활성 노드 일치, horizontal overflow 0px
- 390×844 browser와 6개 프로젝트 fixture에서 sticky 모바일 탐색, 4개 메뉴 각 86px 균등 배치, 프로젝트 선택 후 URL·제목 동기화, horizontal overflow 0px
- URL parser·builder 실행 테스트, 허용 목록·프로젝트 존재·permission 기반 deep-link 복원 source contract test
- 단가표의 동일 ID 수정·활성 상태 전환·확인 단계·pending field lock과 Spring PUT 계약 source-contract test
- 1초~2,147,000,000ms session refresh timer 경계값 실행 테스트와 장기 TTL 회원가입 browser 회귀 검증
- 임시 HTTP 계약 서버를 사용한 회원가입→Settings→단가 생성·수정·비활성화·재활성화→새로고침 복원, console warning·error 0건
- 로컬 production server `/`, `/workspace`, `/proposal/[token]` HTTP 200
- production `/workspace?view=project&project=missing&step=quote` 직접 진입의 인증 화면과 browser console warning·error 없음
- Backend 전체 Gradle test

Vercel Project의 Root Directory는 `frontend`이며 Node 22.x, `npm ci`, 표준 Next.js build를 사용한다. Preview에서는 `NEXT_PUBLIC_API_BASE_URL`을 공개 HTTPS Spring URL로 설정하고 branch-specific Preview exact origin을 Spring CORS에 등록해야 한다. 상세 절차는 [`frontend/VERCEL_PREVIEW.md`](../../frontend/VERCEL_PREVIEW.md)에 기록했다.
