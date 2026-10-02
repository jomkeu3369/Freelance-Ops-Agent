# Chat messenger cloud continuation — 2026-10-02

Source checkpoint: `cf65ab1da67c03b8b471c7ae01682326f30bfc1a` on
`codex/chat-messenger-ui-pc091-20261002`.
Continuation branch: `codex/chat-messenger-ui-cloud-20261002`.

## Implemented

- Restored AI provider, model, personal connection, and pet customization controls in
  the collapsed AI settings section below the conversation. Active work keeps the
  settings locked; completed work retains the new-analysis preparation action.
- Corrected the missing polling error import and both checkpoint compilation errors.
- Kept multiline clarification answers exactly as typed, including outer whitespace.
- Serialized run polling, stopped polling after terminal or denied reads, and prevented
  stale asynchronous run actions/restoration from replacing a newer project/run.
- Reset conversation-local state at project/user/workspace boundaries and protected
  cancellation from repeated submissions.
- Restricted historical result views to read-only review rather than routing their
  comparison action to a different run's quotations.
- Added concise accessible announcements for settings proposals and confirmation.
- Narrowed settings command recognition so ordinary project requests mentioning tax
  percentages, and explicit instructions not to change them, remain agent requests.
  Invalid or ambiguous explicit settings commands cannot create a partial proposal.
- Kept existing domain behavior, colors, raw request content, and real event sources.
  No backend or database changes are included.

## Verification

Using Node **22.23.3**, the final `npm run preview:check` passed:

- TypeScript check
- **71/71** unit and source-contract tests
- ESLint
- Next.js production build

The two source-contract assertions were updated to require untrimmed answers and
accept JSX whitespace normalization, respectively. No check was disabled.

The browser suites discover **65 tests**, including **25 chat tests**. Eight new
regressions cover serialized polling, delayed latest-run restoration, cross-project
start responses, historical/current result actions, ko/en policy announcements,
duplicate cancellation, and retained AI/pet settings controls. Fixture response
barriers and snapshot isolation were also verified without a browser.

**Browser verification is blocked, not passed.** All 65 attempted tests failed at
Chromium launch before any app assertion: its required local socket returns
`Operation not permitted`. The approved shell escalation produced the same error.
The existing cloud browser separately rejected the local fixture preview with
`net::ERR_BLOCKED_BY_CLIENT`; no alternate tunnel or permission bypass was used.
The official Playwright headless-shell installer returned an invalid/truncated archive.

No current screenshot was captured or visually approved. Previous checkpoint images
must not be presented as evidence of this final revision. The remaining QA gate is to
run the full fixture browser suite and inspect actual screenshots at 320/390/1440px,
ko/en, light/dark, including keyboard, reduced-motion, approval/error/cancellation,
reader position, and drafts. Simulated composition/short viewports do not validate a
physical mobile keyboard or a screen reader; those remain separate checks.

## Safety and release status

All browser fixtures use local synthetic accounts and intercepted APIs. No production
API write, real customer data, paid AI request, migration, merge, production deployment, force
push, or branch-protection change was made. DB33 remains separate blocked work.
This is a validated-code backup with a documented browser QA blocker, not a visual
release sign-off. The existing Frontend CI only auto-runs on pull requests or main
pushes; a work-branch backup alone does not claim a remote CI result.

The CLI backup lacked an HTTPS credential, so the connected GitHub API preserved the
four work units as new commits with byte-identical Git trees. Original local commits
are retained in a local backup branch. Commit SHAs differ only because the connector
creates its own commit metadata. The existing Vercel integration can start an automatic
preview for a branch backup; its status is separate from the blocked fixture browser QA.

## API-origin normalization follow-up

The runtime API URL builder now trims outer whitespace consistently with the existing
Vercel environment validator, before its existing trailing-slash removal. Valid
configured origins, the local default, and prior trailing-slash behavior are unchanged.
Three focused regressions execute the actual API client with mocked fetch: validator
consistency, unchanged normal inputs, and valid request construction from padded input.
The final Node 22 `preview:check` passes typecheck, **74/74** unit/source tests, lint,
and production build. No environment setting or backend was changed.

This fixes an independently reproduced code defect. It does **not** establish that
whitespace caused the reported deployed network error; the failing request origin and
browser error are still needed to distinguish configuration, CORS, and transport issues.
