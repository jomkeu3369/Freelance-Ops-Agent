# Completion reservation guards

This feature reserves the conservative cost of a **bounded** platform run before
accepting it. It does not guarantee that arbitrary work finishes, and does not
turn on paid execution. No operator budget is configured by this change.

## Admission and accounting

- The complete aggregate `RunBudget` is pinned in an immutable `completion-v1`
  envelope, with tariff version, policy revision, selected model and permitted
  routing models. Provider/model identities remain exact, without aliases.
- The reservation uses the maximum approved input/cache-read/cache-write rate
  and output rate among the allowlisted models. Aggregate input/output tokens
  include routing, retry attempts, and resumed execution. USD is rounded upward
  to eight decimal places, with `(maxModelCalls - 1) * 0.00000001` additional
  headroom for per-attempt rounding. For nonnegative costs, the sum of N rounded
  costs is at most the rounded aggregate plus N-1 rounding units.
- Model, account-week, global-day and global-week ceilings must accommodate the
  entire reservation. A shortfall rejects before the run/outbox transaction is
  accepted; it never issues a smaller leftover reservation. This also removes
  partial legacy-cap admissions, without upgrading legacy monetary contracts.
- New completion admissions require existing monthly exposure strictly below
  the soft target, and exposure plus the complete reservation no greater than
  the hard ceiling. The last admitted run can cross the soft target; its entire
  reservation was already admitted against the hard ceiling.
- The DB clock and Asia/Seoul calendar define periods. The current month includes
  current-month settled/reserved amounts and prior-month unresolved exposure.
  Open runs carry their whole envelope conservatively. Closed unknown or
  unpriceable liabilities also carry. Month rows are refreshed under the same
  settings-row lock as admission/settlement.
- Carry is monotonic **within a month**. Old-period settlement cannot create new
  current-month capacity. The settlement trigger captures unresolved exposure
  even when an older backend settles before the first monthly admission. A
  positive late cost correction increases current-month exposure. Unresolved
  liability is carried again next month; known closed liability does not require
  new carry. Existing carry remains in its original month for audit.
- Consequently, already-paid cost can be counted conservatively in the month a
  run remains open. A late closure may leave excess carry until the next month.
  This is intentional over-reservation, not a provider bill or a free reset.
- The original reservation and new envelope cannot be updated or deleted.
  Unknown calls keep their pre-call bound; repeated reports cannot erase them.
  Unused exposure is released only after terminal worker closure. User pauses
  retain the reservation. Account, project and run deletion never refunds money.

## Monetary lifetime is separate from execution authorization

A completion envelope does not expire at midnight. A clarification response
continues the same run, model policy, reservation, tariff, and cumulative token,
call and USD ledger. Changing the request budget or reservation identity fails.
Existing legacy envelopes still expire at their original `validUntil`; there is
no automatic renewal or migration into a new full reservation.

The envelope is not authentication. Start/resume still require current signed
execution tokens and permission checks. Dispatch/resume issue fresh tokens using
the existing policy. This change does not extend token TTLs or permit expired
JWTs. Existing tool-token expiry, finite execution time, token/call/retry bounds,
provider outages, price-review dates, unsupported models or response drift can
still stop execution safely. A RUNNING orphan after a crash is still an explicit
unresolved recovery limitation; this patch never replays an uncertain paid call.

BYOK retains its separate scope and personal accounting; it has no platform-key
fallback and receives no completion monetary envelope.

## Additive rollout and rollback

1. Keep `PLATFORM_AI_SPEND_ENABLED=false`. Deploy the new Agent reader and tests
   first. It accepts legacy envelopes with their original expiry behavior.
2. Apply V49 and deploy the new backend with completion issuance disabled. The
   migration preserves all pre-existing limits and adds unconfigured zero
   monthly values plus `completion_required=false`. Both Compose switches default
   to false. Migration alone neither admits paid work nor changes model caps.
3. Before any separately authorized activation, verify every Agent instance has
   the new reader, routing model/reasoning configuration agrees with the DB model
   allowlist, tariffs/provider access are verified, and configured complete-run
   reservations fit every existing cap. Agent admission independently checks its
   actual configured router against the envelope before durable acceptance.
4. Configure a reviewed DB policy and set local completion readiness only after
   that verification. DB `completion_required` is the authoritative activation
   fence; a new backend without local protocol readiness refuses new admissions.
   A deferred constraint rejects an old backend's reservation transaction when
   it cannot supply the immutable completion child. Never clear the DB fence to
   make an incompatible backend continue taking work.
5. An old Agent rejects the additional envelope shape without provider I/O.
   Therefore, it must not receive completion work. Rollback must stop new
   admissions and retain a compatible Agent for outstanding completion scopes;
   do not downgrade active scopes or replay them on a blank store. Retain V49,
   reservations, attempts, settlements and carry tables during application
   rollback. Rolling the database back by deleting accounting is unsafe.

Edits to completion activation, monthly limits or router models increment the
DB completion-policy revision. Accepted envelopes keep their
original policy; a later decrease cannot revoke already-reserved capacity.
Database maintenance that touches settlement must take the settings-row lock
first, matching normal admission/settlement order. There is no public policy
mutation endpoint in this change.

## Verification

Focused Agent tests cover full bounds, model/router restrictions, old expiry,
new monetary continuity, cumulative resume, cancellation and unknown usage,
expired JWT rejection, malformed envelopes and zero-call rejection paths.
Backend tests use disposable PostgreSQL to exercise atomic concurrent admission,
full-cap rejection, transaction rollback, carry, settlement, immutable parents,
policy revisions and the deferred old-binary fence. CI requires PostgreSQL suites
to execute without skips. No test uses production credentials or live providers.

The user-facing model list checks full reservation capacity and monthly policy
for the configured maximum run budget. A smaller explicit requested budget is
still checked independently by admission. Weekly account usage remains a weekly
view; monthly admission failures are reported as separate reasons rather than
misrepresenting the account's weekly balance as the global monthly budget.

External provider pricing changes, taxes, billing-calendar differences, model
usage exceeding the protocol bound and use of credentials outside this service
are outside this application ledger's ceiling guarantee. Preserve fail-closed
pricing, response-model/tier checks and orphan liabilities when investigating.
