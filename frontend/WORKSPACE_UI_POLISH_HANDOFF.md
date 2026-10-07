# Workspace UI handoff — 2026-10-05

Cloud continuation and current verification: [WORKSPACE_UI_CLOUD_VERIFICATION.md](WORKSPACE_UI_CLOUD_VERIFICATION.md). The notes below preserve the earlier laptop checkpoint.

Work is paused at the user's request because the laptop became slow. Continue builds, browser automation, and any Docker work in a cloud execution environment. No Docker commands, container operations, data/volume deletion, deployment, main merge, force push, or permission changes were performed by this task.

## Branch and scope

- Base: `codex/workspace-credit-integration-20261004`, `cfcaeb939129e290e7fbd8ae115414d44f361e5f`.
- Isolated branch: `codex/workspace-ui-polish-20261005`.
- `201c50daa75c762e8348690a26d6f49e192a6bbf`: remove the homepage scroll hint in Korean and English; preserve its animation. Separate commit as requested.
- `12c2042d9157d5e33da4367142c945e33f3f8a8b`: composer controls, compact language menu, weekly usage presentation and guarded server contract adapter. Both implementation commits were pushed successfully.
- The base tree contains no tracked `AGENTS.md`, `.agents/skills`, or `docs/STATUS.md`. Instructions in the pre-existing local checkout and the frontend's bundled Next.js guidance were inspected.

The model button and icon-only Phosphor gear use quiet pointer/open states while retaining a visible keyboard focus outline and a 44px settings target. The idle keyboard/draft hint is removed; Enter, Ctrl/Meta+Enter, and draft storage remain. The workspace gets a KO/EN menu with keyboard navigation and dismissal. No hardcoded model catalog was added.

## Integration boundary

The new ring consumes the draft `GET /api/v2/me/ai-usage` contract: USD limit/settled/reserved/remaining values, server percentages, period/reset/timezone, spendingEnabled, and server model capabilities. Raw decimal strings remain available in details; compact percentages use two decimals and mark rounding. Unknown balances are never replaced with 100 or zero. Reservations and unconfirmed costs remain distinguishable from settlement.

History uses `GET /api/v2/me/ai-usage/history?cursor=&limit=`. Its envelope was not finalized: the adapter accepts a direct array or `{ items, nextCursor }` and rejects malformed data. The supplied model reservation ceiling is labelled as a reservation ceiling, not an estimated charge. Missing/paused/unpriced/unsupported/insufficient-capacity included usage is blocked.

The base backend does not provide the new API. This branch therefore requires integration with the concurrent ledger work before included AI can be used. The old header credit badge and legacy quote/idempotent-retry safeguards remain; no actual backend or production ledger connection was verified. Reconcile these with the new backend instead of treating fixture screenshots as live balances. Existing BYOK behavior is retained.

Likely integration conflicts: `agent-chat.tsx`, `chat-model-controls.tsx`, `project-workbench.tsx`, `app/lib/api.ts`, `fullscreen-chat.css`, and UI translation maps. `features/workspace/shared/constants.tsx` was not changed.

## Verification actually completed

All local browser work used headless Chrome on the user's Windows laptop with synthetic intercepted API fixtures, not production data. No new verification was launched after the stop instruction.

| Check | Result |
| --- | --- |
| Unit tests, Node 22.23.3 | 246 passed, 0 failed |
| TypeScript API using the project tsconfig | 121 source files, 0 errors |
| ESLint API over the frontend | 217 files, 0 errors, 0 warnings |
| Composer/legacy credit browser tests | 14 passed in the initial focused run |
| New control browser tests | 12/13 passed in a follow-up run; remaining mobile header issue corrected and the language/mobile subset then passed 2/2 |
| Complete focused rerun after final lint-only handler placement | Not run |
| Extended 54-test browser run | Interrupted; 34 passes and 3 failures flushed to its log, plus one additional settings failure diagnostic. No complete passing suite |
| Production build | Compilation succeeded in 75 seconds; interrupted during TypeScript processing. Build not complete |
| Backend, agent, DB, production | Not run in this task |

The focused tests exercise pointer versus keyboard outlines, model/gear dismissal, preserved drafts and send shortcuts, exact/rounded usage, unknown/loading/error/zero balances, reservations, history pagination, focus restoration, server model restrictions, KO/EN persistence, and 320px touch emulation. The final mobile header placement was visually inspected. Physical mobile keyboard and assistive technology checks remain outstanding.

Unresolved extended-run diagnostics, to investigate in the cloud without assuming they are all resource-related:

1. `agent-chat.spec.mjs`: the send/cancel/draft/locale test exceeded its 45-second timeout. Its snapshot already showed English and the preserved draft.
2. `chat-messenger.spec.mjs:127`: the test expected an alert containing `Fixture poll failure`; the snapshot showed the localized reconnect status instead.
3. `fullscreen-chat.spec.mjs`, 844×390 case: expected `history-17` while history was still loading.
4. `chat-messenger.spec.mjs:351`: `.model-selection-note` matched two legitimate BYOK notes, causing a strict locator violation. Narrow the test to the intended note, then rerun rather than changing product text merely for the selector.

The interrupted build, extended test, and development-server command sessions were stopped with Ctrl+C. No system-wide process termination was used. The ignored dependency/build outputs and the untracked `.npm-cache/` were preserved and were not committed.

## Reference image limitation

The current Library skill's supported `prepare_materialize` path was called for the exact requested Library image. Its official transfer helper was materialized into this execution environment and executed. On Windows it failed with `AttributeError: module 'os' has no attribute 'setxattr'`. The requested destination did not exist afterward; no original image pixels were read. No path from another environment or guessed image URL was used. Repeat supported Library materialization in the cloud before claiming comparison against the original attachment. Transfer credentials are excluded from the repository.

## Existing screenshot evidence

These are synthetic development screenshots, captured before the stop request and inspected from disk afterward. The Next.js development indicator is visible. They are not the unavailable original user attachment and do not prove a live ledger integration.

- [Desktop composer](docs/assets/workspace-ui-20261005/composer-desktop.png)
- [Keyboard focus and precise usage details](docs/assets/workspace-ui-20261005/usage-keyboard-focus.png)
- [Usage history with an unconfirmed reservation](docs/assets/workspace-ui-20261005/usage-history.png)
- [320px mobile language menu after header correction](docs/assets/workspace-ui-20261005/mobile-language.png)

For cloud continuation: use this branch, install the locked frontend dependencies with a supported Node version, reproduce the four diagnostics and finish the focused/extended tests and build. Integrate and validate the real usage/history contract and server model catalog. Do not run Docker or heavy verification on the laptop. The original reference still needs supported materialization in that new execution environment.
