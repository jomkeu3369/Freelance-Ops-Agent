# Model budget cloud verification — 2026-10-05

Verified source: `ae2a035d9e029ffcd181c864b8a50d600c918421`, tree
`80769a7179b529733e79829d1b608b9211a58dd2`. All 32 changed blobs and the
complete checkout tree matched GitHub before running tests. Work used only the
cloud checkout, cached Java 21/Gradle 9.6.1 and the existing Python 3.12 test
environment. No laptop workload, Docker, production action or paid API call ran.

## Corrections found by aggregate checks

- Legacy Agent usage JSON did not contain `executionClosed` or `unpricedExposure`.
  Jackson rejected these absent primitive fields. Both now normalize to false;
  a missing closure flag cannot release reserved capacity. The HTTP lifecycle
  regression exercises a legacy JSON response.
- Agent attempt admission and settlement now use the backend's eight-decimal USD
  ceiling rounding. GPT-6 Luna cache-write charges can have a ninth decimal;
  summing unrounded attempt values could otherwise fit a cap that the backend's
  individually rounded values exceed. Regressions cover one-token cache writes
  and two-attempt admission at the exact precision boundary.
- Updated offline fixtures to use an approved exact model ID and the pinned
  official OpenAI endpoint. Added unknown-ID and duplicate catalogue coverage.

## Results

- Agent full suite: **410 passed, 8 skipped**, with JUnit output inspected
- Agent Ruff: passed; mypy: **87 source files**, no errors
- Backend full suite: **312 passed, 70 skipped**, zero failures/errors in JUnit XML
  (the count includes skipped Testcontainers class/container entries)
- Python platform SDK: **2 passed**
- Frozen routing release-policy gate: passed against the checked-in report;
  this did not rerun a paid benchmark
- `git diff --check`: passed

Backend used `--offline --no-daemon --max-workers=2` and a test-only Mockito
javaagent init script because dynamic attachment is unsupported in this runtime.
No repository build configuration was changed for that workaround.

**Not verified here:** PostgreSQL/Testcontainers integration and fresh dependency
resolution. The 8 Agent skips require its integration PostgreSQL URL. Backend
skips include all seven `PlatformUsagePostgresTest` cases, all six
`PlatformSpendPostgresTest` cases, and the other database suites. These skips are
not database passes. GitHub Actions was not dispatched from this task.

## Source and integration checks

Rechecked the official [GPT-6 Luna model](https://developers.openai.com/api/docs/models/gpt-6-luna),
[GPT-6.1 Sol model](https://developers.openai.com/api/docs/models/gpt-6.1-sol), and
[prompt-caching accounting](https://developers.openai.com/api/docs/guides/prompt-caching)
pages. Their Standard text rates, separate read/write accounting and supported
reasoning subset match the implemented tariff. Other model references remain
listed in `model-catalog-2026-10-05.md`.

The public usage contract is unchanged; see `platform-usage-api-2026-10-05.md`.
Send eligibility should use `spendingEnabled` and model availability.
`providerAccessVerified=false` is informational. `maxRunUsd` is a ceiling, not a
minimum balance: admission can reserve a smaller remaining amount. History does
not expose `workspaceId`. New starts do not require a fixed-credit quote; retry
idempotency still applies. Admin callers must authorize the target independently.

Platform spending remains disabled; no account/global allowance was increased.
