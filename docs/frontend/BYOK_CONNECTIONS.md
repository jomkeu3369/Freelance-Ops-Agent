# 개인 AI 연결 — 2차

2026-09-12. 사용자 확정 범위는 설정 정리·BYOK이며 펫 외형·성향 생성은 3차다.

## 사용

1. 설정 → AI 연결에서 제공사·허용 모델·API 키를 입력한다. 서버가 공식 모델 조회 API로 접근을 확인한 뒤 암호화 저장한다.
2. 같은 제공사 등록은 기존 연결의 키와 모델을 교체한다. 키는 다시 표시하지 않고 끝 네 자리만 보인다. 검증 실패 시 기존 연결을 유지한다.
3. 분석 시작 전 `기본 제공 AI` 또는 `내 키`를 선택한다. 기본 제공이 초기값이며 개인 연결 오류 시 자동 전환하지 않는다.
4. 견적 가정 제안은 해당 분석의 연결을 이어서 사용한다. 개인 연결 실행은 시작한 사용자만 재개할 수 있다.
5. 삭제하면 다음 모델 호출·재개가 중단된다. 이미 제공사에 전송된 호출은 취소되지 않는다. 교체한 연결의 모델이 기존 실행과 다르면 새 분석을 시작한다.

개인 키 분석·가정 제안의 모델 호출은 제공사 계정에 청구된다. 예상 AI 비용은 기존 가격 원장 기준 참고값이며 실제 청구액·서비스 요금과 다르다. 가격 미등록은 무료/0원으로 표시하지 않는다. 검색·라우팅·임베딩은 별도 서비스 경로이며 개인 키 연결로 모든 서비스 비용이 없어지는 것은 아니다.

초기 OpenAI 모델은 기존 운영 목록을 따른다. Gemini 개인 연결은 공식 모델 목록에서 확인한 `gemini-2.5-flash`를 초기 지원한다. 운영자가 허용 목록을 비활성화하면 `준비 중`으로 표시한다. 등록 확인은 모델 접근 검사이며 생성 성공이나 잔여 크레딧 보장이 아니다. 실제 키의 모델 실행 품질은 사용자가 최종 확인한다.

## 공개 API

모두 `/api/v2/workspaces/{workspaceId}/ai-connections` 아래에 있으며 로그인과 현재 `agent.run` 권한을 요구한다.

| 호출 | 입력/출력 |
| --- | --- |
| GET | `available`, 제공사별 `models`, 본인 `connections` 목록 |
| PUT `/{provider}` | `{model, apiKey}` → `{id, provider, model, maskedKey, updatedAt}` |
| DELETE `/{id}` | 본인 연결만 삭제, 성공 204 |

실행·가정 제안의 `modelSelection.credentialId`는 선택 사항이다. 누락/null은 기본 제공, UUID는 개인 연결이다. 원문 키는 실행 계약·outbox·checkpoint에 들어가지 않는다. 개인 실행은 270초 이하이고 위임 토큰은 실행 시간+30초, 최대 5분이다. 내부 자격 증명 endpoint는 Tool 관측/감사 payload로 취급하지 않는다.

## 운영·복구

- `APP_BYOK_ENCRYPTION_KEY`: 독립적인 32-byte base64 AES-GCM 키. 운영 배포의 `ensure-byok-key.sh`가 기존 비공개 `.env`에 최초 한 번 생성한다. 값은 로그에 출력하지 않으며 기존 값이 잘못되면 덮어쓰지 않고 중단한다.
- `APP_BYOK_OPENAI_MODELS`, `APP_BYOK_GEMINI_MODELS`: 제공사별 쉼표 구분 허용 모델. 공통 Agent gateway allowlist가 설정되어 있으면 양쪽 목록을 맞춘다.
- 배포와 rollback은 기존 암호화 키를 유지한다. DB 복원에는 **동일한 암호화 키**가 필요하다. 기존 비공개 운영 환경 백업에 포함하고 DB dump와 접근 권한을 분리한다. 키 분실 시 저장된 연결은 복호화할 수 없어 재등록해야 한다.
- 자동 키 순환은 제공하지 않는다. 변경하려면 기존 키로 복호화·새 키로 재암호화하는 별도 migration 계획이 필요하다.
- 등록 검증에는 기존 Agent 요청 제한이 적용된다. 키/모델 조회 endpoint는 고정이며 redirect를 따르지 않는다. 잘못된 입력 오류는 원문이나 rejected value를 반환·기록하지 않는다.

## 검증 상태

로컬·CI·브라우저 및 배포 결과는 이번 PR의 START 검증 기록에 남긴다. 합성 fixture 테스트와 실제 제공사 호출은 구분한다.

공급자 목록 근거: [Gemini 모델 목록](https://ai.google.dev/gemini-api/docs/models), 2026-09-12 확인. 개인 연결에는 플랫폼 기본 Gemini 키 설정이 필요하지 않다.

## 로컬 검증 기록 — 2026-09-12

- Frontend Node 22 `preview:check`: 타입·55개 테스트·ESLint·운영 빌드 성공. 검증 fixture 제거 후 다시 빌드했다.
- Backend `gradlew test`: 243개 중 230개 성공, Docker 의존 13개 skip. AES-GCM 변조/소유자 binding, 원문 오류 비노출, 권한 회수, 다른 사용자 재개 차단, 요청 제한, 토큰 최대 5분을 포함한다.
- Agent 전체: 300개 성공, PostgreSQL 의존 8개 skip. 이후 Gemini 포함 BYOK 5개 대상 검사 성공. Ruff·mypy 82 source 성공.
- OpenAPI 2개와 Compose 기본·인프라 설정 검사 성공. 로컬 Git Bash에는 flock이 없어 운영 키 생성 shell 회귀는 Linux CI에서 검증한다.
- Chromium 합성 로컬 fixture: 등록 실패/성공, 교체, 삭제 확인/완료, 입력 비움, 개인 연결 ID의 분석 전달, 320/390px 가로 넘침 없음, 1440px와 라이트/다크 배치, 최종 브라우저 콘솔 오류 없음. 테스트 화면·가상 API는 배포 source에서 제거했다.
- 미검증: 실제 개인 키의 과금·잔액·제공사 생성 품질. UI 검증은 실제 제공사 호출을 대신하지 않는다. CI의 실제 PostgreSQL migration/소유권/교체·삭제 검증과 운영 배포는 PR에서 이어 확인한다.

## 원격 검증

[PR #36](https://github.com/jomkeu3369/Freelance-Ops-Agent/pull/36)의 구현 commit 318126c는 검사 8개를 통과했다. [Agent CI](https://github.com/jomkeu3369/Freelance-Ops-Agent/actions/runs/34679866973)는 PostgreSQL 포함 309개 테스트, SDK 2개, Ruff·mypy·release gate를 통과했다. [Spring CI](https://github.com/jomkeu3369/Freelance-Ops-Agent/actions/runs/34679866950)의 test·image, [Frontend CI](https://github.com/jomkeu3369/Freelance-Ops-Agent/actions/runs/34679867007), Vercel Preview가 성공했다. [Contracts CI](https://github.com/jomkeu3369/Freelance-Ops-Agent/actions/runs/34679866978)는 운영 키 생성·보존·권한·비노출·잘못된 기존 키 거부 회귀를 통과했다. 최종 병합 commit과 운영 CD 결과는 PR의 Result 기록을 따른다.
