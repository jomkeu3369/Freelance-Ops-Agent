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
