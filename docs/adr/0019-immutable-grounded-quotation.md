# ADR-0019: 근거 기반 Immutable Quotation Revision

- 상태: Accepted
- 결정일: 2026-08-13

## Context

V1은 LLM이 만든 견적의 계산 근거와 변경 이력을 충분히 보존하지 못했다. V2는 AI 없이도 사용자가 수동 견적을 작성할 수 있어야 하고, 발행 후 변경 내역과 각 금액의 근거를 감사할 수 있어야 한다. 금액 계산을 LLM에 맡기지 않는 아키텍처 불변조건도 지켜야 한다.

## Decision

- Rate Card와 Estimation Policy는 workspace 범위로 저장한다.
- 견적은 scenario와 series를 가지는 immutable version이다. 발행본을 변경하지 않고 최신 version에서만 새 revision을 만든다.
- 모든 견적 항목은 evidence 또는 assumption 중 정확히 하나와 연결한다. DB CHECK와 Java entity 불변조건을 함께 적용한다.
- Evidence는 source type, reference, title, excerpt, retrieved date를 보존한다.
- 수량×단가, 최소 금액, 할인, 위험 버퍼, 세금과 합계는 `QuotationCalculator`가 `BigDecimal`과 명시적 반올림으로 결정한다.
- Workspace의 maximum discount를 넘는 요청과 currency가 다른 Rate Card는 거부한다.
- 발행에는 `quotation.publish`, 작성과 revision에는 `quotation.write` permission을 요구한다.
- 실제 결과는 별도 Outcome으로 기록하며 발행 견적과 WBS 항목을 선택적으로 연결한다.

## Consequences

- 견적 변경 이력과 항목별 근거를 재현할 수 있다.
- LLM 출력과 실제 금액 계산의 책임이 분리된다.
- 견적·근거 table이 늘어나지만 DB 수준에서 cross-workspace 관계와 근거 누락을 차단한다.
- 전자서명, 공개 share token과 고객 decision UI는 후속 범위다.
