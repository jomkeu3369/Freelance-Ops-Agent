# 모델 예산 통합 검증 — 2026-10-05

검증 소스는 `ae2a035d9e029ffcd181c864b8a50d600c918421`, 트리는 `80769a7179b529733e79829d1b608b9211a58dd2`다. 실행 전 변경 파일 32개의 객체와 전체 트리가 GitHub와 일치함을 확인했다. Java 21·Gradle 9.6.1·Python 3.12 환경의 당시 기록이며 운영 변경·유료 API·Docker 검사는 수행하지 않았다.

## 발견한 문제

- 과거 사용량 JSON에 `executionClosed`, `unpricedExposure`가 없으면 Jackson의 기본형 필드 검증이 실패했다. 누락은 false로 정규화하며 종료 확인 누락으로 예약을 해제하지 않는다.
- Agent의 호출 승인·정산을 Backend와 같은 USD 소수 여덟 자리 올림으로 맞췄다. GPT-6 Luna 캐시 쓰기 비용의 아홉 번째 소수 때문에 합산과 개별 올림이 다른 상한을 허용할 수 있었다. 한 토큰 쓰기와 두 번의 호출 경계 검사를 추가했다.
- 오프라인 fixture는 승인된 정확한 모델 ID와 고정 OpenAI 주소를 사용하도록 고쳤다. 알 수 없는 ID와 중복 카탈로그도 검사했다.

## 실행 결과

| 범위                    | 결과                                                              |
| ----------------------- | ----------------------------------------------------------------- |
| Agent 전체              | 410개 통과·PostgreSQL 8개 생략, JUnit 확인                        |
| 정적 검사               | Ruff 통과, mypy 87개 소스 오류 0                                  |
| Backend 전체            | 312개 통과·70개 생략, 실패·오류 0. 생략 수에는 컨테이너 항목 포함 |
| Python SDK              | 2개 통과                                                          |
| 고정 라우팅 릴리스 기준 | 저장된 보고서로 통과, 새 유료 평가 아님                           |
| 변경 내역               | `git diff --check` 통과                                           |

Backend는 오프라인·단일 데몬 미사용·최대 작업자 2개와 테스트용 Mockito javaagent를 사용했다. 환경 우회를 위해 저장소 빌드 설정을 바꾸지 않았다. 전체 의존성 재해석은 하지 않았다.

당시 `PlatformUsagePostgresTest` 7개·`PlatformSpendPostgresTest` 6개를 포함한 DB 검사는 생략됐다. Agent 8개도 실제 통합 DB 주소가 필요했다. 이 수치를 DB 통과로 해석하지 않으며 당시 작업에서 Actions를 새로 실행하지 않았다. 이후 통합 결과는 [기능 통합 기록](cloud-feature-integration-2026-10-05.md)과 [제품 근거](../portfolio/product-evidence.md)를 따른다.

## 계약과 가격 기준

당시 [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna), [GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol), [프롬프트 캐시](https://developers.openai.com/api/docs/guides/prompt-caching)의 텍스트 단가·읽기/쓰기 구분·추론 범위를 코드 가격표와 대조했다. 나머지 출처와 단가는 [가격표 검증 기록](model-catalog-2026-10-05.md)에 보존한다. 이 문서는 오늘의 제공사 가격을 보증하지 않는다.

화면은 [사용량 API](platform-usage-api-2026-10-05.md)의 `spendingEnabled`와 모델 사용 가능 여부를 사용한다. `providerAccessVerified=false`는 안내 정보다. `maxRunUsd`는 상한이므로 잔액이 더 작아도 서버가 적은 금액을 예약할 수 있다. 이력에 `workspaceId`를 가정하지 않고 신규 실행에는 고정 크레딧 견적을 요구하지 않는다. 재전송의 동일성·관리자 우선 인가는 유지한다.

이 검증은 플랫폼 지출 활성화나 계정·전체 제공량 증가를 포함하지 않았다.
