# Actual-cost weekly usage API

New starts use exact USD admission and settlement. `creditQuote` is accepted only
as legacy request metadata and no longer charges fixed model credits. Historical
credit reservations and APIs retain their old settlement semantics. Do not use
`/api/v2/usage/free` to display new cost-proportional allowances.

## User and administrator integration

- `GET /api/v2/me/ai-usage`: authenticated subject only; no selectable user ID.
- `GET /api/v2/me/ai-usage/history?limit=20&cursor=...`: 1–100 entries, opaque
  cursor with timestamp and run ID, response `{items, nextCursor}`.
- Internal trusted service: `PlatformUsageService.snapshot(UUID userId)` and
  `PlatformUsageService.history(UUID userId, String cursor, int limit)`.
  Administrator callers must independently require their `MEMBERS_READ` grant.
  Calling the service does not confer authorization or create an admin grant.

Snapshot fields:

```json
{
  "currency": "USD", "limitUsd": 1.25,
  "settledUsd": 0.02, "reservedUsd": 0.03, "remainingUsd": 1.20,
  "remainingPercent": 96.0000, "reservedPercent": 2.4000,
  "periodStart": "2026-10-05", "resetAt": "2026-10-11T15:00:00Z",
  "timezone": "Asia/Seoul", "spendingEnabled": false,
  "models": []
}
```

Amounts are Java BigDecimal JSON numbers with eight-decimal USD ledger precision;
percentages round down to four decimals and must never be used to authorize spend.
Remaining means **available after both confirmed usage and reservations**.
Reserved means in-flight capacity or a conservative unknown-attempt hold; it is
not a claim that the provider billed that amount. Usage is reconciled from durable
Agent checkpoints, normally at the existing five-second reconciliation cadence.

Each `models` item has `provider`, `model`, `catalogued`, `enabled`,
`reasoningEfforts`, `maxRunUsd`, `available`, `unavailableReason`,
`providerAccessVerified` (false until independently verified). Local admission
availability does not guarantee provider permissions, balance or a sufficiently
small first request. Reason codes: `SPENDING_DISABLED`, `MODEL_DISABLED`,
`TARIFF_REVIEW_REQUIRED`, `ACCOUNT_BUDGET_EXHAUSTED`, `GLOBAL_BUDGET_EXHAUSTED`.

History item fields: `runId`, `model`, `status`, `startedAt`, `platformCostUsd`
(confirmed platform cost), `platformReservedUsd`, `usageKnown`,
`byokInputTokens`, `byokOutputTokens`, `providerCalls` (existing attempt DTO).
Unknown BYOK token counts remain conservative bounds; inspect each attempt's
`usageKnown`. `fundingSource=BYOK` has no platform USD charge. Platform routing
inside a BYOK run still consumes the platform budget. No prompt or key is returned.
Deleted runs keep cost records, with history status `DELETED`.

## Accounting invariants

- V42 has explicit model caps; V43 adds settlement and attempt tables. No account
  or global limit is increased and `platform.ai.spend.enabled` stays false.
- Admission, holds, run creation and outbox are one transaction. The granted cap
  is the minimum of model cap and remaining account/day/week budgets. Empty
  budgets fail closed; smaller residual amounts may still support cheap calls.
- Agent commits a conservative attempt before HTTP I/O and commits returned
  usage afterwards. Retries have distinct IDs. Missing cache details retain bounds.
- Spring recomputes cost using the reservation's immutable tariff and deduplicates
  attempt IDs. Settled attempts cannot change model, funding or token usage.
- Confirmed usage moves from reserved to settled. Active runs retain their total
  cap; only terminal status **and** `executionClosed` worker evidence release
  unused capacity. Cancellation acknowledgement alone releases nothing.
- Failed/partial/cancelled runs still pay confirmed usage; unknown calls retain
  their attempt bound. No-cost work closes at zero confirmed cost.
- A crashed/unreported worker retains its cap. No TTL refund. Reconciliation
  continues for terminal runs waiting for closure evidence. Duplicate and stale
  reports cannot refund a later observation or double charge it.
- Settlement adjusts the admission's original day/week buckets. Monday Korea
  boundary and week rollover never transfer an old hold into a new allowance.
- Legacy v1 reservations retain their previous full conservative exposure.
  Product-credit resets, account/workspace/run deletion do not erase monetary holds.

## Integration ownership

Model/default changes overlap only `frontend/features/workspace/shared/constants.tsx`
and `frontend/.env.example`. The separate UI task should wire its ring, selection,
and Send eligibility to this API, remove fixed credit labels/quotes from new user
flows and use `spendingEnabled`/model availability. Main-page design is untouched.
