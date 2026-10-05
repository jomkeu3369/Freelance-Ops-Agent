# Workspace controls: cloud continuation, 2026-10-05

## Scope and result

Continues the backed-up `b6dbe8c9a75be1cc11c5c72094b0452f0a720074` UI tree on the same work branch. All continuation commands ran on dot's cloud computer; no laptop, Docker, main merge, production deployment, paid AI request, or budget/permission change was performed.

The requested attachment was successfully materialized and its actual pixels inspected on this executor. It shows the compact model selector and outlined settings pill. The four prior screenshots in `docs/assets/workspace-ui-20261005/` were also inspected; they remain historical synthetic-fixture evidence, not screenshots of this final revision or observed billing.

The prior polish remains intact: quiet pointer states with keyboard focus, gear-only settings and tooltip, removed idle Enter/draft hint, circular remaining-usage meter with hover/focus/tap details, integrated KO/EN menu, and removal of the homepage's exact Korean/English scroll hint without altering its animation.

## Actual-cost contract corrections

- New chat starts and the header no longer query or depend on legacy fixed-credit balances. New starts omit `creditQuote`; an already-uncertain retry may retain its original metadata and idempotency key.
- Eligibility uses the USD snapshot, spending switch, server model availability and supported LOW reasoning. Catalogue membership never implies that spending is enabled. `providerAccessVerified=false` is explicitly disclosed and is informational, as specified by the backend owner.
- Small positive residual budgets are allowed for server admission. The backend clamps the reservation cap and remains authoritative about whether a request fits. No client percentage authorizes spend.
- History accepts the real `{items,nextCursor}` DTO without a nonexistent `workspaceId`. Deleted and unconfirmed records remain visible. Unconfirmed BYOK token totals are labelled as conservative bounds.
- Visible pages refresh account usage every 15 seconds and on focus, including after terminal status while settlement may still be pending. Hidden pages do not poll. Error, paused, empty-limit and unknown states never invent a 100% balance.
- Operating-budget rejection refreshes usage without holding up the error message, preserves the draft and never automatically resends.

This aligns with ledger branch `bb7215848f1ae5a4d450fa421b51ce62a0411a79` and its `docs/testing/platform-usage-api-2026-10-05.md`. This UI branch alone still lacks those backend endpoints. Merge the two work branches in the integration branch before live ledger verification; no main merge is implied.

## Verification

Node 22.23.3, locked existing dependencies matching this branch:

- TypeScript: passed
- Node unit/source tests: 249 passed, zero failed
- ESLint: zero errors and zero warnings after the final hook cleanup
- Standard `npm run preview:check`: passed, including the full production build
- `git diff --check`: passed

The expanded 71-case browser suite is **not verified on the final code**. A launch attempt and one approved retry could not create Chromium's process-singleton Unix socket (`Operation not permitted`), before any test reached the app. The supported cloud-browser fallback refused the local preview with `ERR_BLOCKED_BY_CLIENT`; the access restriction was not bypassed. These are environment launch/access failures, not 71 demonstrated product regressions.

Two stale regression expectations were corrected: reconnect status replaces a raw fixture polling error, and BYOK settings assertions now select the intended note. Credit-flow tests were rewritten for actual-cost admission and exact retry identity. The original send/draft/locale timeout and landscape history-loading diagnostic still require browser execution. New tests cover real history shape, provider-access metadata, full/zero/unknown balances, residual budget and removal of old credit gating.

Run the 71 browser scenarios when an authorized preview/browser can access the app. Keep test fixtures isolated from production. Physical mobile keyboard and assistive-technology checks, authenticated live-ledger/DB integration, and paid-provider access remain unverified.
