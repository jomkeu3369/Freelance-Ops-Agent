# Actual-cost admin controls

## Problem and scope

New platform-funded starts use `platform_spend_settings`,
`platform_spend_model_cap`, and the immutable monetary ledger. The old `/admin`
screen edited `weekly_credit_*` while claiming that a zero credit limit or a
disabled credit model would stop new platform starts. Those controls no longer
govern new actual-cost admission.

The replacement must use the same monetary settings as admission and the weekly
usage API. Ordinary usage stays percentage-based. Administrative values are
explicitly denominated in USD, with eight-decimal precision. Personal-key scopes
remain independent of platform monetary settings.

## Safety boundaries

- Preserve all existing monetary defaults and immutable reservation tariffs
- Keep the runtime spending switch read-only; settings edits cannot enable it
- A zero account/global allowance, zero model cap, or disabled model blocks new
  platform admission; already admitted work keeps its original reservation
- Never clear confirmed cost, unknown holds, or prior period buckets when editing
  settings; do not offer a monetary reset/refund operation
- Use the existing platform administration capability and current account/grant
  checks, optimistic revisions, transaction locks, and durable audit records
- Require explicit review of administrative edits; stale responses and stale
  revisions must not silently apply a previously reviewed change

No production settings, accounts, paid provider calls, merges, or deployments
are part of this work.

## Administrative API

- `GET /api/v2/admin/ai-spending` reads the current monetary settings
- `PATCH /api/v2/admin/ai-spending` changes the account weekly, global daily, and
  global weekly budgets with `expectedRevision`
- `PATCH /api/v2/admin/ai-spending/models` changes one supported model's
  `maxRunUsd` and `enabled` flag with the same shared revision

Amounts remain BigDecimal in the server. The three budget response fields use
plain decimal strings so even preserved legacy NUMERIC(19,8) values remain
exact. New budget edits are bounded to 100000 USD and model edits to 100 USD;
these validation bounds do not change any saved amount. Existing larger budgets
remain readable and can be explicitly lowered through the reviewed edit flow.
There is no spending-switch or reset mutation. Unknown write fields are rejected.

The old credit APIs remain for historical compatibility; the current `/admin`
screen does not call them. `PLATFORM_SPEND` audit entries use settings revisions
in the existing audit envelope's epoch-shaped fields, with explicit UI labels.

## Local checks

Node 22.23.3 frontend type checks, all 342 Node tests, lint, and production build
passed. The selected browser suites contain 34 cases (23 monetary-admin and 11
member-admin). Local Chromium could not create a required Unix socket, so no
browser assertions ran locally. Browser checks must run in GitHub CI.

The first backend implementation commit `dee5983` passed the full Spring job,
Flyway migrations, and mandatory database no-skip gate in
[Backend CI](https://github.com/jomkeu3369/Freelance-Ops-Agent/actions/runs/37395533141/job/112050476555).
Later compatibility and final integrated changes require fresh CI; this earlier
pass is not a claim that those later changes were tested by that run.

## Baseline evidence

At review, main was `963afc9a1d9f785720f4a2bd08a7eb4b9d48ea4f`.
All 891 backend/Agent blobs matched server release
`00ba39b14fe6fd05aea9b011514bb70d17cbf79e`. Its
[Spring job](https://github.com/jomkeu3369/Freelance-Ops-Agent/actions/runs/37331993227/job/111837250391)
and [Agent job](https://github.com/jomkeu3369/Freelance-Ops-Agent/actions/runs/37331993227/job/111837250326)
passed, including the required database-suite no-skip gates.

All 324 frontend blobs matched the
[browser-tested work branch](https://github.com/jomkeu3369/Freelance-Ops-Agent/actions/runs/37337541144/job/111856010344).
The main branch's synthetic-browser job itself was skipped by its branch rule.
The seven monetary presentation tests were rerun in the cloud and passed with no
skips. This is source/fixture evidence, not authenticated production browser QA
or a fresh inspection of live monetary configuration.

## Verification required for the change

1. New settings and model APIs reject unauthorized callers, invalid monetary
   values, unsupported models, stale revisions, and attempts to mutate the
   runtime spending switch
2. PostgreSQL tests drive the real monetary admission path after administrative
   zero-limit/model-disable edits, preserving old holds and BYOK independence
3. Parallel admission and edits serialize against the same settings row;
   successful edits write an immutable audit entry once
4. Synthetic browser tests cover exact decimal payloads, review/cancel,
   repeated clicks, stale settings, revoked access, session changes, and narrow
   viewports without a production account or provider request
5. Run final frontend type checks, unit tests, lint, build, and selected synthetic
   browser suites; require backend PostgreSQL suites without skips in CI
