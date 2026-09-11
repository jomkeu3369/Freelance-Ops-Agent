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
