# 실제 비용 기반 사용량 API

2026-10-16 코드와 대조한 계약 안내다. 신규 기본 제공 AI는 USD 예약·정산을, V47 개인 키 실행은 별도 호출·토큰·시간 예산을 사용한다. `creditQuote`는 과거 요청의 호환 메타데이터이며 신규 실행에 모델별 고정 크레딧을 부과하지 않는다. `/api/v2/usage/free`로 새 금액 한도를 표시하지 않는다.

## 사용자·관리자 조회

- `GET /api/v2/me/ai-usage`: 로그인한 본인의 사용량. 임의 사용자 ID는 받지 않는다.
- `GET /api/v2/me/ai-usage/history?limit=20&cursor=...`: 1–100건, 응답은 `{items, nextCursor}`다. 시각과 실행 ID가 담긴 커서는 해석하거나 페이지 번호로 바꾸지 않고 그대로 전달한다.
- `PlatformUsageService.snapshot(userId)`, `history(userId, cursor, limit)`를 사용하는 관리자 경로는 대상 조회 전에 별도로 현재 `MEMBERS_READ` 권한을 검사한다. 서비스 호출 자체가 관리자 권한을 부여하지 않는다.

금액과 날짜는 응답 형태를 설명하는 예시다.

```json
{
  "currency": "USD",
  "limitUsd": 1.25,
  "settledUsd": 0.02,
  "reservedUsd": 0.03,
  "remainingUsd": 1.2,
  "remainingPercent": 96.0,
  "reservedPercent": 2.4,
  "periodStart": "2026-10-05",
  "resetAt": "2026-10-11T15:00:00Z",
  "timezone": "Asia/Seoul",
  "spendingEnabled": false,
  "models": []
}
```

금액은 Java `BigDecimal`의 JSON 숫자이며 원장은 USD 소수 여덟 자리 정밀도를 사용한다. 비율은 네 자리에서 내림하고 지출 승인에 사용하지 않는다. 남은 금액은 확정 사용량과 예약을 모두 뺀 값이다. 예약은 진행 중 작업 또는 사용량 미확정 호출의 보수적 상한이며 제공사의 확정 청구가 아니다. 영속 체크포인트의 사용량은 기본 5초 간격의 대조 절차로 반영한다.

모델별 응답은 `provider`, `model`, `catalogued`, `enabled`, `reasoningEfforts`, `maxRunUsd`, `available`, `unavailableReason`, `providerAccessVerified`를 포함한다. `maxRunUsd`는 최대 예약액이며 그보다 작은 잔액도 서버 심사를 받을 수 있다. 로컬 실행 가능 판정은 제공사 권한·잔액·첫 요청의 적합성을 보장하지 않는다. 미확인 `providerAccessVerified=false`는 안내 정보다.

대표 차단 사유는 `SPENDING_DISABLED`, `MODEL_DISABLED`, `TARIFF_REVIEW_REQUIRED`, `ACCOUNT_BUDGET_EXHAUSTED`, `GLOBAL_BUDGET_EXHAUSTED`다.

## 실행 이력

`runId`, `model`, `status`, `startedAt`, `platformCostUsd`, `platformReservedUsd`, `usageKnown`, `byokInputTokens`, `byokOutputTokens`, `providerCalls`를 반환한다. 존재하지 않는 `workspaceId`를 응답에 가정하지 않는다. 삭제된 실행도 비용 기록을 유지하며 상태는 `DELETED`로 표시한다. 프롬프트와 키는 반환하지 않는다.

V47 개인 키 실행의 토큰은 승인한 보수적 상한이며 제공사 청구량이 아니다. 해당 시도는 `usageKnown=false`로 남고 플랫폼 USD 비용·예약은 0이다. 로컬 라우팅·키워드 검색을 사용하며 추가 플랫폼 유료 호출은 없다. 이전 혼합 결제 실행은 당시 플랫폼 정산을 유지하고 `fundingSource=BYOK` 시도 자체에는 플랫폼 금액을 부과하지 않는다.

## 예약·정산 규칙

- V42는 모델별 상한, V43은 정산·시도 원장이다. 계정·전체 한도를 문서 갱신으로 늘리지 않으며 `platform.ai.spend.enabled` 기본값은 false다.
- 실행 생성·예약·발송 대기 명령은 하나의 트랜잭션이다. 예약은 모델 상한과 계정·일간·주간 잔액의 최솟값이며 잔액이 없으면 거부한다.
- Agent는 HTTP 요청 전에 시도의 보수적 상한을, 응답 뒤에는 확인한 사용량을 영속화한다. 재시도 ID는 별개다. 캐시 읽기·쓰기 정보가 없으면 상한을 유지한다.
- Spring은 예약 시 고정한 가격표로 다시 계산하고 시도 ID로 중복을 막는다. 정산된 모델·결제 출처·토큰을 바꾸지 않는다.
- 확정 사용량만 예약에서 정산으로 옮긴다. 미사용 예약 해제에는 종료 상태와 작업자의 `executionClosed` 확인이 모두 필요하다. 취소 접수만으로 해제하지 않는다.
- 실패·부분 완료·취소에도 확인된 사용량은 정산한다. 미확정 호출·보고 없는 작업자는 상한을 유지하며 시간 만료만으로 환불하지 않는다.
- 정산은 원래 예약한 일간·주간 구간에 반영한다. 한국 시간 월요일 경계를 넘어도 옛 예약을 새 제공량으로 옮기지 않는다.
- 과거 v1 예약의 보수적 노출은 유지한다. 크레딧 초기화나 계정·워크스페이스·실행 삭제가 금액 예약을 지우지 않는다.

## 개인 키 실행

현재 승인 상한은 입력 150,000토큰, 출력 48,000토큰, 50회 호출, 180초다. 공용 설정이 허용하는 시간이 더 짧으면 그 값을 따른다. 연결·모델·추론 수준·사용자·워크스페이스·프로젝트·비용 안내 버전·마감은 변경할 수 없는 실행 범위에 고정한다.

매 호출 전 Spring에서 현재 접근과 토큰 상한을 검사·예약하고 Agent 체크포인트에 시도를 남긴 뒤 선택한 키로 요청한다. 같은 호출 ID를 두 번 승인하지 않는다. 재시도·재개·취소·사용량 누락·삭제로 예산이나 마감을 복구하지 않으며 닫은 범위는 다시 열지 않는다. 플랫폼 키로의 전환과 별도 유료 라우팅·임베딩·조사는 허용하지 않는다.

## 확인 위치

[PlatformUsageService](../../backend/src/main/java/com/freelanceops/backend/domain/agentrun/service/PlatformUsageService.java), [PlatformSpendService](../../backend/src/main/java/com/freelanceops/backend/domain/agentrun/service/PlatformSpendService.java), [ByokExecutionService](../../backend/src/main/java/com/freelanceops/backend/domain/agentrun/service/ByokExecutionService.java), [AgentBudgetPolicy](../../backend/src/main/java/com/freelanceops/backend/domain/agentrun/service/AgentBudgetPolicy.java)를 기준으로 계약을 확인한다. 당시 통합 검사는 [검증 기록](cloud-feature-integration-2026-10-05.md), 최근 배포는 [제품 근거](../portfolio/product-evidence.md)를 따른다. 실제 제공사 권한·청구·결과 품질은 별도 검증 사항이다.
