# Freelance Ops Frontend

Next.js 호환 `vinext`, React 19, TypeScript로 만든 V2 프런트엔드 콘셉트입니다.

- 라이트 모드: 친근한 프리랜서용 Paper Studio
- 다크 모드: 집중도 높은 개발자용 Night Workshop
- 첫 화면: 고객 문의와 AI 초안을 분리해 검토하는 Project Intake
- 모션: GSAP ScrollTrigger 기반 reveal, scrub, card stacking

## 실행

Node.js 22.13 이상이 필요합니다.

```bash
npm install
npm run dev
```

검증 명령은 다음과 같습니다.

```bash
npm run typecheck
npm run lint
npm test
```

배포 환경에서는 `NEXT_PUBLIC_SITE_URL`을 실제 공개 주소로 설정하면 Open Graph 이미지 URL도 해당 주소를 사용합니다.
