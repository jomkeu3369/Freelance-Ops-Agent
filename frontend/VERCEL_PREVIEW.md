# Vercel Preview Runbook

## Project 설정

- Root Directory: `frontend`
- Framework Preset: `Next.js`
- Node.js: `22.x` (`package.json`의 `engines.node`가 기준)
- Install Command: `npm ci`
- Build Command: `npm run build`
- Output Directory: 비워 둔다. Vercel의 Next.js build output을 사용한다.

`vercel.json`에도 같은 install/build/framework 설정을 기록해 Dashboard의 암묵적 기본값에만 의존하지 않는다.

## Preview 환경 변수

| 이름 | 필수 | 설명 |
|---|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | 필수 | 브라우저에서 접근 가능한 HTTPS Spring 공개 API origin. 경로와 마지막 `/` 없이 설정한다. |
| `NEXT_PUBLIC_DEFAULT_MODEL` | 선택 | OpenAI 모델 목록을 따로 설정하지 않았을 때 첫 선택값으로 사용한다. |
| `NEXT_PUBLIC_OPENAI_MODELS` | 권장 | AI 실행 화면에 표시할 OpenAI 모델을 쉼표로 구분한다. |
| `NEXT_PUBLIC_GEMINI_MODELS` | 선택 | AI 실행 화면에 표시할 Gemini 모델을 쉼표로 구분한다. 비어 있으면 Gemini 선택을 잠근다. |
| `NEXT_PUBLIC_SITE_URL` | 선택 | canonical/OG origin을 강제로 지정할 때 사용한다. 미설정 시 Preview의 `VERCEL_URL`을 사용한다. |

`NEXT_PUBLIC_*` 값은 client bundle에 포함되므로 secret을 넣지 않는다. Preview 변수를 바꾸면 기존 배포에는 반영되지 않으므로 새 Preview Deployment를 생성한다.

Vercel build에서는 `scripts/validate-vercel-env.mjs`가 다음 조건을 fail-fast로 검사한다.

- `NEXT_PUBLIC_API_BASE_URL` 필수
- HTTPS origin만 허용
- path, query, hash, trailing slash와 URL credential 금지
- localhost와 loopback origin 금지
- `NEXT_PUBLIC_SITE_URL`이 없으면 Vercel system variable `VERCEL_URL` 필수

## Spring CORS

Spring은 wildcard를 허용하지 않고 exact origin만 받는다. PR마다 달라지는 commit URL 대신 Vercel의 안정적인 branch-specific Preview URL을 확인해 Backend의 `APP_CORS_ALLOWED_ORIGINS`에 추가한다. Production origin과 localhost origin도 필요한 환경에서 각각 명시한다.

예시 형식:

```text
APP_CORS_ALLOWED_ORIGINS=https://feature-branch-your-project.vercel.app,https://your-production-domain.example
```

## 배포 전 검증

```bash
npm ci
npm run preview:check
```

합격 조건:

1. `next build`가 `/`, `/workspace`, `/proposal/[token]` route를 생성한다.
2. `vinext`, Vite, Wrangler와 Cloudflare Worker/D1/R2 package 또는 source import가 없다.
3. Preview의 `NEXT_PUBLIC_API_BASE_URL`이 HTTPS Spring API를 가리킨다.
4. Spring CORS에 branch-specific Preview exact origin이 등록되어 있다.
5. Preview에서 로그인, refresh, Workspace API, Agent SSE와 공개 proposal을 smoke test한다.

GitHub `V2 CI`의 frontend job도 Node 22와 Vercel Preview fixture 환경에서 같은 `npm ci`와 `npm run preview:check`를 실행한다.

실제 Preview 생성은 non-production branch push 또는 `vercel` CLI 실행으로 수행한다. Production 승격은 Preview 검수 후 별도로 진행한다.
