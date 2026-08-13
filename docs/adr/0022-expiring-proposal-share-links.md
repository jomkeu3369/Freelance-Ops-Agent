# ADR-0022: 발행 견적의 만료 가능한 Proposal 공유 링크

- 상태: Accepted
- 결정일: 2026-08-14

## Context

V2의 견적은 내부 workspace 데이터이지만 실제 거래를 위해 고객에게 전달할 수 있어야 한다. 인증 계정을 고객마다 만들면 초기 전환 비용이 커지고, 영구 URL이나 quotation UUID만 공개하면 추측·재사용·회수가 어렵다. 공유 시점 이후 내부 데이터가 바뀌어 고객이 본 결과가 달라지는 것도 피해야 한다.

## Decision

- 공유 대상은 `PUBLISHED` quotation revision으로 제한한다.
- 256-bit 난수의 URL-safe opaque token을 생성하고 원문은 생성 응답에서 한 번만 반환한다.
- database에는 token 원문이 아닌 SHA-256 hash만 저장한다.
- share는 workspace와 quotation의 복합 FK를 사용하고 1~30일 만료 및 명시적 revoke를 지원한다.
- quotation의 `valid_until`보다 share 만료가 늦어질 수 없으며 이미 만료된 quotation은 공유하지 않는다.
- 공개 조회는 invalid·expired·revoked token을 모두 `404`로 처리해 존재 여부를 구분해 노출하지 않는다.
- 공개 응답은 project 제목, 발행 시점, 금액, WBS 항목과 근거만 포함하고 workspace·작성자·rate card ID 같은 내부 식별자는 제거한다.
- 발행된 quotation은 수정하지 않고 새 revision을 생성하므로 공유 응답은 해당 revision을 계속 가리킨다.

## Consequences

고객 계정 없이도 회수 가능한 제안서를 전달할 수 있고 token database 유출 시 원문을 즉시 사용할 수 없다. 반면 URL을 받은 사람은 만료 전까지 조회할 수 있으므로 사용자는 링크를 비밀로 취급해야 하며, 높은 보안이 필요한 거래에는 향후 PIN 또는 고객 인증을 별도 ADR로 추가해야 한다.
