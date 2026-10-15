# 프런트엔드 의존성 보안 점검 — 2026-10-11

기준은 main `9a48b5d18672f02fdcb30269b1dffc3f0a414d24`다. 패키지·잠금 파일과 관련 설정을 대조한 **당시 보안 점검 기록**이며 현재 취약점 수나 운영 버전을 보증하지 않는다. 침투 테스트는 아니다.

## 변경과 결과

기준 npm audit는 high 패키지 항목 5개를 보고했다. 직접 운영 의존성 `next@16.3.6`의 여섯 권고와 `@next/eslint-plugin-next → fast-glob → micromatch → braces`의 개발용 항목 네 개였다. 후자 네 항목은 동일 braces 권고의 연쇄 결과이며 독립적인 앱 취약점 네 개가 아니다.

Next와 ESLint 플러그인을 16.3.8로 함께 올리고 잠금 파일의 `@next/env`·플랫폼 SWC를 맞췄다. 마이너/메이저 갱신·강제 audit fix·override·무관한 패키지 변경은 하지 않았고 `sharp@0.35.5`도 유지했다.

| 깨끗한 설치 뒤 검사           | 당시 결과                                            |
| ----------------------------- | ---------------------------------------------------- |
| `npm audit --omit=dev --json` | 취약점 0                                             |
| `npm audit --json`            | 개발용 braces 경로의 high 4개, 종료 코드는 실패 유지 |

이는 2026-10-11 권고 DB의 시점 기록이다. Next 권고는 10월 7일 공개됐으며 기존 braces 문제를 신규 문제로 세지 않았다. [Next 16.3.8 릴리스](https://github.com/vercel/next.js/releases/tag/v16.3.8)와 당시 npm 메타데이터를 기준으로 호환 패치를 확인했다.

## 패치 전 소스의 적용 범위

| 권고                                                                                                    | 필요한 조건                                  | 당시 저장소 확인                                                                                   |
| ------------------------------------------------------------------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| [GHSA-cjq9-62q9-8jv4](https://github.com/advisories/GHSA-cjq9-62q9-8jv4), 이미지 SSRF                   | 공격자 제어 원격 이미지 호스트 허용          | `images.remotePatterns` 없음. 권고의 영향 조건과 구분                                              |
| [GHSA-3w37-wq28-93x7](https://github.com/advisories/GHSA-3w37-wq28-93x7), Draft Mode 캐시 누출          | 캐시 컴포넌트·use-cache와 초안 의존 미리보기 | `cacheComponents`, `use cache`, `draftMode` 사용 없음                                              |
| [GHSA-4jqv-mc3x-m676](https://github.com/advisories/GHSA-4jqv-mc3x-m676), 자체 호스팅 SSG/ISR 캐시 오염 | 자체 호스팅 Pages Router                     | App Router·표준 Vercel 구성, Pages 디렉터리 없음. 권고는 Vercel 제외, 실제 호스팅 별도 감사는 아님 |
| [GHSA-f87g-xv8r-7p7x](https://github.com/advisories/GHSA-f87g-xv8r-7p7x), 메타데이터 이미지 우회        | Webpack 생성 이미지와 dynamicParams 제한     | 생성 이미지·dynamicParams·generateStaticParams 없음, 정적 `/og.png` 사용                           |
| [GHSA-mcj8-r9mp-w47p](https://github.com/advisories/GHSA-mcj8-r9mp-w47p), 응답 캐시 오염                | 루트 catch-all과 SSG/ISR                     | 루트 catch-all 없음. 프로젝트·토큰은 이름 있는 구간                                                |
| [GHSA-39w2-rjm5-chcv](https://github.com/advisories/GHSA-39w2-rjm5-chcv), 개발 MCP 노출                 | next dev 실행 중 악성 출처 방문              | 개발 명령이 해당 경로를 사용하므로 관련 있음. 운영 next start와 구분                               |

패키지 경고를 이 앱의 원격 공격 성공 근거로 해석하지 않았으나 호환 패치로 영향 버전과 관련 개발 서버 문제를 제거했다.

## 남은 개발용 문제

[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)은 `braces <=3.0.3`의 깊은 패턴으로 Node 스택을 소진할 수 있는 문제다. 검토일에는 수정 버전이 없었다.

```text
@next/eslint-plugin-next@16.3.8 (개발)
└── fast-glob@3.3.1
    └── micromatch@4.0.8
        └── braces@3.0.3
next@16.3.8
└── sharp@0.35.5
```

전체 braces 경로는 잠금 파일에서 개발용이다. 플러그인의 `get-root-dirs.js`는 명시적 `settings.next.rootDir` 패턴에 fast-glob을 사용하지만 저장소 ESLint에는 해당 설정이 없었고 앱이 이 경로를 import하지 않았다. HTTP 사용자 입력이 도달하는 경로도 발견하지 못했다. 다만 신뢰하지 않는 glob을 빌드 도구에 넣는 로컬 서비스 거부 위험까지 없다고 판단하지 않았다.

당시 npm의 자동 수정은 플러그인을 14.2.35로 낮춰 Next 16과 분리하는 메이저 변경이어서 적용하지 않았다. 경고를 숨기기 위한 비지원 override나 린트 규칙 제거도 하지 않았다. 다음 도구 갱신 때는 공식 권고와 레지스트리를 다시 확인한다.

## 검증

Node.js 22.23.3·npm 11.9.0에서 `npm ci`, 타입·단위 **464/464**·ESLint, 정상 Next 16.3.8 Turbopack 빌드를 통과했다. 빌드 환경은 `NEXT_TELEMETRY_DISABLED=1`, `VERCEL=0`, `NEXT_PUBLIC_API_BASE_URL=http://localhost:8080`이었다.

로컬 Chromium은 앱 실행 전 소켓 제한으로 시작하지 못했다. 같은 후보의 외부 요청 차단 브라우저 239개를 Actions 대상으로 구성했으나 이 기록의 로컬 통과 수에는 포함하지 않는다. 실제 계정·키·Backend·OCR·유료 호출·운영 배포는 이 패치 검증에 사용하지 않았다. 이후 전체 검사와 배포는 [제품 근거](../portfolio/product-evidence.md)에 연결한다.
