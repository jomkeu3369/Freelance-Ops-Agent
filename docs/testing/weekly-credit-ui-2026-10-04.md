# Weekly credit UI verification

The fullscreen workspace now consumes the weekly credit API contract. It does not infer prices or allowances from client defaults: legacy, malformed, or unavailable usage blocks new included-AI requests. Explicit personal-key requests omit the platform credit quote.

Before Send, the composer shows the selected model's server price and remaining balance. Quote rejection refreshes the price and requires a new user Send. An ambiguous response retains the original request, quote, and idempotency key for an exact retry in the current workspace session. Operating-budget guards are explained separately from the account's credit balance.

Administrator model-rate changes require a before/after review and explicit acknowledgment. They use the exact reviewed epoch/version string. Settings reads cannot overwrite an in-flight mutation or restore a previous account's state. Standalone pet/assumption generation remains disabled until its own budget integration exists, including for personal-key mode; manual editing and saved-result reading remain available.

## Checked locally

- TypeScript and ESLint passed
- 234 unit tests passed, including malformed balances, microsecond quote versions, exact retries, administrator response races, and disabled standalone generation
- Optimized Next.js build passed
- Independent read-only review found no remaining P1/P2 issues after the balance and administrator race fixes

## Limits

- New Playwright API-fixture cases are included but were not executed here; the configured browser is unavailable in this environment
- No real AI request, credit deduction, administrator setting change, database migration, or production deployment was performed
- The backend credit contract is developed separately and requires a deliberate combined integration; successful UI checks do not establish live API availability
- Visual preview data is isolated to the separate preview-only fixture branch and is never an authentication bypass
