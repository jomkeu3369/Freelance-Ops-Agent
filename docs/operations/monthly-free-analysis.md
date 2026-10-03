# Monthly free analysis allowance

## Product boundary

- Default: five **platform-key analysis runs per account** per calendar month in `Asia/Seoul`. The next period begins at 00:00 KST on the first day; the database clock is authoritative and no reset cron or browser clock is needed.
- All workspaces share one account allowance. The authenticated initiating account owns the reservation, even if another authorized workspace member later resumes the same run.
- A start reserves one slot before the run and START outbox command commit. `used + reserved` must be below the current limit. Any later failure in that transaction rolls back all three.
- Confirmed `COMPLETED` and `PARTIAL` output consumes one slot. Confirmed `FAILED` or `CANCELLED` Agent views release the reservation. Waiting, running, network timeouts, uncertain command delivery, and local projection failure do not release it. There is deliberately no TTL refund.
- Refunds are free-analysis entitlements, not reversals of provider costs. Cancelled/failed requests can still incur provider costs. Existing per-run model/token/search/time budgets and separate pet/day caps remain enforced.
- A personal-key run bypasses this monthly analysis allowance but still requires the selected connection, permissions and run budgets. It never falls back to a platform key. Routing evaluation/embedding can still incur platform costs. Registering a key does not start a run.
- This does not introduce a universal budget across pets, assumption suggestions, RAPTOR, research tasks or other model features. Their existing guards remain separate; operators must retain overall provider spending controls.

## Stable accounting and retries

`free_usage_bucket` is keyed by account, starting calendar month, and reset generation. `free_usage_reservation` keeps the original key, so month-crossing completion and completion after an admin reset settle the original bucket. Deleting a project or workspace does not delete/refund its reservation. Account deletion cascades the user-owned usage records, consistent with account data removal.

POST analysis starts accept `Idempotency-Key` (8–128 ASCII letters, digits, `_` or `-`). The frontend generates one key per actual start action and reuses it for transport/auth retry. The backend serializes starts for the account and records a request hash covering workspace, project and all body fields. Replaying the same key returns its original run ID and acceptance time without new work. Reusing it for different input returns 409. Keys survive reset/month rollover/project deletion, and there is no automatic cleanup that could silently enable replay. Legacy callers without the header retain independent-start semantics.

Unknown delivery can leave a reservation pending. The existing reconciler settles active runs when it obtains an authoritative terminal Agent view. Locally failed/removed runs with no authoritative Agent response require investigation; a timer must not declare them free. A global reset is an explicit new allowance, not a claim that old execution stopped.

## Separate site administration

The separate `/admin` route is only a UI. Every admin API independently requires an ACTIVE account with a non-revoked `FREE_USAGE_ADMIN` row in `app.platform_admin_grant`. Workspace OWNER/ADMIN, JWT role claims, email matching, a hidden URL, and the first registered account grant no platform access.

V37 creates **no admin assignee** and exposes no self-grant API. Grant provisioning/revocation needs a separately authorized operational change for a verified account. This implementation does not grant access to any live account.

- `GET /api/v2/usage/free`: own account allowance and `canManage` capability
- `GET /api/v2/admin/free-usage`: current global settings
- `PATCH /api/v2/admin/free-usage`: integer `limit` 0–100, `expectedEpoch`, `expectedUpdatedAt`; zero pauses new free starts without cancelling existing work
- `POST /api/v2/admin/free-usage/reset`: literal `confirmation: "RESET_ALL_FREE_USAGE"`, `expectedEpoch`, `expectedUpdatedAt`

A limit change applies immediately to all current accounts but does not reset counts, cancel runs or settle reservations. Lowering below current occupancy blocks further free starts. Increasing the limit may increase platform costs. The 100 cap is a conservative code/database safety bound, not an advertising integration.

Reset locks the singleton settings row and increments its generation. Everyone receives a new allocation under the current limit, while old in-flight requests remain historical and may continue to incur costs. The UI requires an explicit confirmation and warns that old requests continue. Both changes use optimistic preconditions; stale forms fail 409 and must be reviewed again. Settings timestamps are monotonically advanced. Actor UUID, action, old/new limit and old/new generation are appended to `free_usage_admin_audit`, whose UPDATE/DELETE trigger protects history. Reset never DELETEs historical usage or audit records.

## Exhaustion contract

Only the typed `FREE_USAGE_EXHAUSTED` response (HTTP 429) opens the central API-registration dialog. It includes `limit`, `used`, `reserved` and `resetAt`. Provider 429s, pet limits, invalid connections and ordinary budget errors must not open that dialog. The CTA preserves workspace/project context and draft; the user must explicitly choose a connection and start again.

## Release checks

1. Run backend unit/security/PostgreSQL integration tests against the exact final commit with Gradle and Docker available. V37 is forward-only; no production migration was executed during implementation.
2. Run frontend `npm run preview:check` and mocked browser coverage. Never use a real paid model call or production global reset as a smoke test.
3. Review the chosen failure/cancellation entitlement policy and retain provider/platform spending alerts. This counter is not a dollar-spend ceiling.
4. Provision a verified platform administrator only after separate authorization. Verify ordinary/workspace-admin accounts receive 403 from both mutation endpoints.
5. Apply V37 through the normal approved release process, then deploy compatible backend/frontend together. Existing pre-feature runs have no reservation and are not retroactively charged against the new allowance.

AdSense, tracking, payments, Claude and Ollama are not activated by this change.
