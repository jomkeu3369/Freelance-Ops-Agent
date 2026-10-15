# 개인 AI 연결 검증 — 2026-09-12

당시 구현과 환경의 검증 기록이다. 현재 지원 제공사와 실행 예산은 [개인 AI 연결 안내](../frontend/BYOK_CONNECTIONS.md)를 따른다.

## 로컬 검증 기록 — 2026-09-12

- Frontend Node 22 `preview:check`: 타입·55개 테스트·ESLint·운영 빌드 성공. 검증 fixture 제거 후 다시 빌드했다.
- Backend `gradlew test`: 243개 중 230개 성공, Docker 의존 13개 skip. AES-GCM 변조/소유자 binding, 원문 오류 비노출, 권한 회수, 다른 사용자 재개 차단, 요청 제한, 토큰 최대 5분을 포함한다.
- Agent 전체: 300개 성공, PostgreSQL 의존 8개 skip. 이후 Gemini 포함 BYOK 5개 대상 검사 성공. Ruff·mypy 82 source 성공.
- OpenAPI 2개와 Compose 기본·인프라 설정 검사 성공. 로컬 Git Bash에는 flock이 없어 운영 키 생성 shell 회귀는 Linux CI에서 검증한다.
- Chromium 합성 로컬 fixture: 등록 실패/성공, 교체, 삭제 확인/완료, 입력 비움, 개인 연결 ID의 분석 전달, 320/390px 가로 넘침 없음, 1440px와 라이트/다크 배치, 최종 브라우저 콘솔 오류 없음. 테스트 화면·가상 API는 배포 source에서 제거했다.
- 미검증: 실제 개인 키의 과금·잔액·제공사 생성 품질. UI 검증은 실제 제공사 호출을 대신하지 않는다. CI의 실제 PostgreSQL migration/소유권/교체·삭제 검증과 운영 배포는 PR에서 이어 확인한다.

## 원격 검증

[PR #36](https://github.com/jomkeu3369/Freelance-Ops-Agent/pull/36)의 구현 commit 318126c는 검사 8개를 통과했다. [Agent CI](https://github.com/jomkeu3369/Freelance-Ops-Agent/actions/runs/34679866973)는 PostgreSQL 포함 309개 테스트, SDK 2개, Ruff·mypy·release gate를 통과했다. [Spring CI](https://github.com/jomkeu3369/Freelance-Ops-Agent/actions/runs/34679866950)의 test·image, [Frontend CI](https://github.com/jomkeu3369/Freelance-Ops-Agent/actions/runs/34679867007), Vercel Preview가 성공했다. [Contracts CI](https://github.com/jomkeu3369/Freelance-Ops-Agent/actions/runs/34679866978)는 운영 키 생성·보존·권한·비노출·잘못된 기존 키 거부 회귀를 통과했다. 최종 병합 commit과 운영 CD 결과는 PR의 Result 기록을 따른다.
