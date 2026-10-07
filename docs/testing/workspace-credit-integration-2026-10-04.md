# Fullscreen workspace / weekly-credit integration

## Source and scope

This work branch combines the real fullscreen frontend (`3ea6816196dd4dc76fa69fbd8c7650ba64eef186`) and the weekly-credit/platform-spend backend and agent (`a8a764ce66dbb08d3752db929cb781bdc87ede7b`) on verified main `4743d0d08676a60f373f4faaadb80c991c44d2ce`.

Combining those two trees alone left required APIs absent. The integration selectively restores the already-committed prerequisites from `11dab74` (history/internal progress), `0a07e33` (reviewed setting proposals), `7f2eeea` (release-disabled verification/notices), and the strict registration age field from `c2975a1`. Shared budget-sensitive files were reconciled rather than replaced with their older versions.

V36 is the estimation-policy proposal migration; V38 is email verification; V39 is the operational notice registry. V37, V40 and V41 retain the weekly-credit and monetary-reservation chain. Migration filenames V1–V41 are unique and contiguous. Database execution remains a separate gate.

The screenshot-only route and offline Research/DeepAgents changes are excluded. Main's landing, WebGL implementation and README files are unchanged. No policy text, administrator grant, production configuration, credential fallback change, CORS change or email delivery was added or executed.

## Cross-language contract checks

`contracts/fixtures/workspace-credit-contract.json` contains synthetic data shared by:

- `frontend/tests/workspace-credit-contract.test.mjs`, which executes the actual TypeScript API builders and credit/retry policy
- `WorkspaceCreditContractTest`, which exercises actual Java DTO validation, MockMvc controller boundaries and response serialization

The shared fixture is included in the frontend CI path filters as well as the backend contracts checks.

Checks cover exact START payload and whitespace, raw microsecond price versions, BYOK quote omission, model prices/remaining credits, reviewed administrator mutations/reset, quote-vs-credit-vs-operating errors, and resume without a second START quote. The frontend does not infer a refund from a failed run; the shared settled-usage response governs the changed balance.

Additional regressions exercise resume without a new reservation, terminal settlement only after authoritative acknowledgement, and internal task progress under the same monetary ledger. PostgreSQL tests cover isolated and dual notice/credit administrator capabilities, including selective revocation, but require a real database runtime to execute.

## Verification

Final counts: frontend 242 passed; backend 372 total, 309 passed and 63 Docker/PostgreSQL-dependent skips; agent 390 passed and 8 PostgreSQL-dependent skips. Ruff passed and mypy passed across 87 source files. Frontend TypeScript, ESLint, all 242 unit tests and the optimized Next.js build passed. Java tests use verified Java 21 and Gradle 9.6.1 with an explicit official Mockito test agent; agent tests use the existing isolated Python 3.12 environment. Relevant package versions match the lockfile, but a complete `uv sync --locked` was not run.

Independent read-only review found no weakening of credit reservations, non-refundable monetary holds, replay/snapshot checks, same-root delegation accounting, resume finality, or administrator capability isolation.

## Release gates

- No actual database migration, real AI request, credit deduction/refund, administrator mutation, email send, main merge or production deployment occurred
- Docker/PostgreSQL-dependent suites remain skipped, so their transactional/concurrency assertions are not claimed as executed
- `platform.ai.spend.enabled` remains false by default. This applies to BYOK too: generation is charged to the user's provider account, but routing still consumes protected platform resources
- Current server-priceable analysis models are OpenAI Luna/Terra. Personal keys do not bypass supported-model or operating-budget limits; the UI now states that explicitly
- Standalone pet/assumption/RAPTOR generation, paid embeddings/web research and detached Research remain blocked until they have integrated budgets
- Live provider names, service-tier behavior, monetary/token-envelope assumptions and cross-instance cancellation still require authorized deployment validation
- Email verification enforcement and operational notice dispatch remain disabled by default; their mail adapter fails closed
- Deployed frontend authentication/API-origin compatibility was not changed. A successful preview build does not prove the existing production backend runs this code
- Existing actual-component browser screenshots verify the frontend layout, not the combined live API or real weekly billing. New contract tests do not substitute for browser or database end-to-end verification
