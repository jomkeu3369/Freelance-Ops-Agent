# Freelance Ops Frontend

Next.js 16 App Router, React 19와 TypeScript로 만든 V2 frontend입니다. Vercel의 표준 Next.js runtime을 사용하며 vinext·Vite·Cloudflare Worker adapter에 의존하지 않습니다.

## 로컬 실행

Vercel Preview와 동일한 Node.js 22.x를 사용합니다.

```bash
npm ci
npm run dev
```

`.env.example`을 참고해 `.env.local`을 만들고 `NEXT_PUBLIC_API_BASE_URL`에 브라우저가 접근할 수 있는 Spring 공개 API origin을 지정합니다.

## 검증

```bash
npm run preview:check
```

이 명령은 typecheck, Node test, ESLint와 표준 `next build`를 순서대로 실행합니다. Vercel에서는 build 전에 공개 API·site origin validator가 실행되어 필수 환경 변수 누락과 비HTTPS·path·credential·loopback URL을 차단합니다. 개별 명령은 `npm run typecheck`, `npm test`, `npm run lint`, `npm run build`입니다.

## Vercel Preview

Vercel Project의 Root Directory를 `frontend`로 지정합니다. `vercel.json`은 framework를 Next.js로 고정하고 `npm ci`와 `npm run build`를 사용합니다. Preview 환경에는 `NEXT_PUBLIC_API_BASE_URL`을 반드시 설정해야 합니다.

상세 설정과 검수 절차는 [`VERCEL_PREVIEW.md`](VERCEL_PREVIEW.md)를 따릅니다.

## 페이지별 수정 위치

`app`은 주소와 레이아웃을 연결하고, 실제 화면과 동작은 `features`에서 수정합니다. 페이지 문구나 폼을 바꾸기 위해 공통 레이아웃을 수정할 필요가 없습니다.

| 주소 | 화면 코드 | 담당 범위 |
| --- | --- | --- |
| `/` | `features/home/` | 소개 문구, 예시 데이터, 섹션, 애니메이션 |
| `/workspace/projects` | `features/workspace/projects/` | 프로젝트 목록, 검색, 정렬, 단계 변경 |
| `/workspace/clients` | `features/workspace/clients/` | 고객 조회·등록·수정 |
| `/workspace/knowledge` | `features/workspace/knowledge/` | 근거 자료 조회·업로드 |
| `/workspace/settings` | `features/workspace/settings/` | 서비스 단가, 세율, 모델 요금 |
| `/workspace/projects/[projectId]/intake` | `features/workspace/project/intake/` | 문의 및 요구사항 검토 |
| `/workspace/projects/[projectId]/agent` | `features/workspace/project/analysis/` | 분석 진행, 추가 질문, 결과·사용량 |
| `/workspace/projects/[projectId]/quote` | `features/workspace/project/quotation/` | 견적 초안, 항목 편집, 발행·공유 |
| `/workspace/projects/[projectId]/outcome` | `features/workspace/project/outcome/` | 실제 공수·비용·성과 기록 |
| `/proposal/[token]` | `features/proposal/` | 고객용 공개 제안서와 응답 |

`/workspace`와 기존 `?view=project&project=...&step=...` 링크는 독립 주소로 연결합니다. 로그인 전 열었던 주소는 로그인 후에도 유지합니다. 프로젝트별 단계 이동과 브라우저 뒤로가기는 주소를 기준으로 복원합니다.

## 여러 사람이 함께 수정하는 방법

1. 위 표의 폴더 단위로 담당자를 나눕니다. 예를 들어 고객 관리 담당자는 `clients/`, 견적 담당자는 `project/quotation/` 안에서 작업합니다.
2. JSX는 화면을 읽는 순서대로 작성하고 저장·발행처럼 여러 단계의 동작은 이름 있는 함수로 둡니다. 컴포넌트 입력은 `Props` 인터페이스로 설명합니다. 함수 매개변수는 가로로 작성하고 마지막 콤마는 생략합니다.
3. 화면 표시 함수·라벨·문서 변환은 `features/workspace/shared/`를 먼저 확인합니다. 다른 페이지의 컴포넌트 안에 있는 함수를 가져오는 대신 공통 함수를 이 폴더에 둡니다.
4. `workspace-shell.tsx`와 `workspace-context.tsx`는 로그인 세션·작업 공간·현재 프로젝트·실시간 실행 상태를 공유하는 경계입니다. 이 파일의 계약을 바꿀 때는 다른 화면 담당자와 먼저 맞춥니다. 페이지에서 별도의 로그인 세션을 만들지 않습니다.
5. 서버 요청은 기존 `app/lib/api.ts`를 사용합니다. 화면에서 서버 주소와 인증 처리를 다시 작성하지 않습니다.
6. 공통 스타일은 `app/globals.css`, 작업 공간 스타일은 `app/workspace/figma-workspace.css`, 빠른 문의 스타일은 `app/workspace/quick-intake.css`입니다. 기존 스타일 적용 순서를 유지하기 위해 스타일 파일은 이번에 이동하지 않았습니다. 공통 CSS를 바꿀 때는 다른 화면에도 영향이 있는지 확인합니다.

메인 소개의 세부 수정 지도는 [`features/home/README.md`](features/home/README.md)를 참고합니다. 작업 후 `npm run preview:check`로 타입·회귀 검사·린트·빌드를 함께 확인합니다.

## 분리 작업 검증 기록 (2026-09-11)

Node 22에서 타입 검사, 테스트 51개, 린트, 프로덕션 빌드를 통과했습니다. 실제 로컬 Spring 서버에 연결해 메뉴 이동, 검색·목록 보기·선택 위치 복원, 로그인 전의 기존 상세 링크 호환, 견적 저장과 공개 제안서 응답 저장을 확인했습니다. 검수 프로젝트와 공유 링크, 임시 실행 환경은 정리했으며 가상 계정과 작업 공간은 로컬에 남습니다. 실제 휴대폰 검증과 새 AI 모델 실행은 이번 코드 분리 검증에 포함하지 않았습니다.

## 월간 무료 분석과 사이트 관리자

분석 화면과 설정에 계정 전체의 월간 사용·예약·잔여 횟수, 한국 시간 기준 초기화 시각을 표시합니다. 완료 및 부분 결과가 있는 분석은 사용량으로 계산하며 진행 중에는 한도를 예약합니다. `FREE_USAGE_EXHAUSTED` 오류만 API 등록 안내를 엽니다. 다른 429 응답은 일반 오류로 남습니다. API 등록 이동은 작성하던 프로젝트 주소를 보존하며, 키 등록이나 복귀는 분석을 자동 실행하지 않습니다.

`/admin`은 서버가 확인한 사이트 관리자만 월간 한도를 변경하거나 전체 사용량을 초기화할 수 있는 별도 페이지입니다. 작업 공간 권한으로 관리자 권한을 추정하지 않습니다. 각 변경에는 영향·비용 경고와 별도의 승인이 필요하며, 설정이 바뀌면 다시 조회하고 새로 승인해야 합니다. 실제 관리 권한 부여 절차와 예약·초기화 의미는 [`monthly-free-analysis.md`](../docs/operations/monthly-free-analysis.md)를 참고하세요.

프론트엔드 회귀 검사:

```bash
npm run preview:check
# 로컬 개발 서버를 기본 테스트 주소 127.0.0.1:3100에서 실행한 뒤:
npm run test:ui -- tests/browser/free-usage.spec.mjs
```

브라우저 검사는 API 응답을 모킹하며 실제 API 키, 유료 AI 호출, 운영 관리자 변경을 사용하지 않습니다.

## 이메일 소유 확인과 운영 공지

- `/verify-email`: URL fragment의 확인 토큰을 메모리에만 보관하고 주소 기록에서 즉시 지웁니다. 사용자가 비밀번호·확인을 입력하고 버튼을 눌러야 확인 요청을 보냅니다. 새로 가입하는 경우 이 단계에서 비밀번호를 설정하며, 기존 계정의 비밀번호는 변경하지 않습니다. 비밀번호는 12~72자이면서 UTF-8 기준 72바이트 이하이어야 합니다. 확인 후 로그인 화면으로 이동하며 세션을 자동 발급하지 않습니다.
- 인증 rollout이 활성화된 가입 응답은 로그인 세션과 다른 타입입니다. 가입 가능한 이메일인지 밝히지 않는 안내와 재요청 폼을 표시합니다. 기존 만 14세 이상 필수 확인은 그대로 유지합니다.
- `/notices`: 게시 시각이 지난 공개 운영 공지만 표시합니다. 비공개 초안, 향후 공지, 약관·개인정보 버전 정보와 예시 공지는 공개 목록에 포함하지 않습니다.
- `/admin/notices`: 서버의 별도 `NOTICES_ADMIN` 권한을 확인한 뒤 비공개 초안, 개정 번호를 포함한 검토·게시 승인, 확인된 이메일 수신자 스냅샷, 관리자 본인 테스트, 대기열 승인과 미발송 취소를 제공합니다. `/admin`의 기존 월간 무료 분석 관리는 유지합니다.
- 메일 대기열 승인에는 고정된 제목·버전·본문·정확한 수신자 수와 본인 테스트 확인이 필요합니다. 수신자 0명 또는 접수되지 않은 테스트로는 승인할 수 없습니다. 전송 비활성 상태는 전송 성공으로 표시하지 않습니다. 발송 실행 UI는 포함하지 않습니다.
- 약관·개인정보는 비공개 버전 정보만 저장하며 본문 입력과 공개 게시가 없습니다. 광고·쿠폰·판촉 메일은 지원하지 않으며 공지나 발송은 약관 동의를 대신하지 않습니다.

회귀 검사:

```bash
npm run preview:check
# 로컬 서버 실행 후, 모든 API를 가로채는 모의 응답으로만 검사:
npm run test:ui -- tests/browser/verified-notices.spec.mjs tests/browser/signup-age.spec.mjs
```

브라우저 검사는 가입·이메일 확인·관리자 변경 요청을 모두 모킹하고 외부 통신을 차단합니다. 실제 가입, 이메일 전송, 공지 게시 또는 운영 관리자 변경을 수행하지 않습니다.

## Professional conversation workspace (2026-10-03)

The workspace now uses a compact navigation rail with real recent-project links, a centered conversation surface, separate activity disclosures and reviewable result cards. The composer remains mounted while work is running and keeps drafts scoped to the user, workspace and project. New-message following remains opt-in when the reader has scrolled into history. Offline status prevents sending and never automatically resubmits the draft.

AI settings can be opened and focused directly from the composer. Settings group personal AI connections and account usage near the top; setup guidance is a native disclosure. Compact usage in a project keeps used, limit, reserved and remaining counts visible, with reset rules behind a disclosure. There are no new provider integrations or backend/API changes.

Visual implementation lives in `features/workspace/professional-workspace.css`, loaded after existing workspace styles. It is scoped away from public pages and authentication. Light/dark tokens, smaller-screen document flow, wrapped long content, reduced-motion treatment and keyboard focus are included.

Validation:
- Node 22: `npm run preview:check` checks TypeScript, all Node tests, ESLint and production build
- `tests/chat-presentation.test.mjs` covers real-state presentation, terminal result absence, localization and preserved navigation/approval boundaries
- `tests/browser/professional-workspace.spec.mjs` adds mock-only draft/navigation, 320/390/640/1280px reflow, focus, offline and English/reduced-motion cases; it does not add a public mock or authentication-bypass route
- Browser tests were collected but not executed in this environment: Chromium socket/sandbox restrictions were already confirmed, and the authenticated preview remains behind the existing login/CORS gate. The source/build checks are not a rendered accessibility, 200/300/400% zoom, screenshot or end-to-end pass
