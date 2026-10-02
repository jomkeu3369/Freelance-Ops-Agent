# Chat messenger UI checkpoint (2026-10-02, PC091)

Base: 20a0e374689417dae021d41be1d5b890d22bd053.
Branch: codex/chat-messenger-ui-pc091-20261002.
Implementation moved to the user's dot cloud PC; no further UI work runs on this PC.
This commit is a recovery checkpoint, not a verified release. No push or deployment.

## Changes to continue

- One conversation containing the original request, real event summary, clarification
  questions, result opener, and a single before/after quote-settings approval card.
- Optional detailed result/activity/PetWorkspace; model and pet settings are being
  moved out of the primary flow. Preserve the existing provider/model/personal-key choices.
- Session-scoped drafts, exact request text, IME-aware Ctrl/Command+Enter, newline entry,
  immediate submission guards, next-request drafting while a run remains active.
- Reader-aware following, new-message button, keyboard scrolling, short message entrance
  respecting reduced motion, readable statuses and translated interface copy.
- Local Playwright API fixtures and browser regressions; no real AI/backend requests.

## Known defects at checkpoint

1. ProjectWorkbench references aiSettings without declaring it. The last string edit
   removed the old disclosure but its insertion failed because the file used CRLF.
   Restore the provider/model/connection/PetCustomizer disclosure from the Git base and
   define it as aiSettings below the primary conversation. Do not omit those controls.
2. WorkspaceShell's temporary polling-error recovery references ApiError without the
   existing API import. This yields two TypeScript diagnostics at the same expression.

These defects were recorded immediately when the user stopped local implementation.
They were not hidden by disabling type checks or removed assertions.

## Verification status

- Baseline: existing chat browser tests 2/2 passed; before screenshots saved.
- Earlier implemented revision: typecheck passed; existing chat browser tests 2/2 passed;
  new messenger tests 14/14 passed (320/390/1440, ko/en, light/dark, reduced motion,
  keyboard result focus, simulated Korean composition, duplicate request/answer guards,
  exact multiline text, failed sends/answers with reload drafts, permission checks,
  reconnect/event deduplication, preserving reader position, simulated keyboard space).
- Earlier unit run: 65/69 passed. Four source-shape assertions described the former
  graph/review layout and were updated. Their final passing run is still outstanding.
- Earlier lint: one tabindex diagnostic on the scrollable log. A documented single-line
  exception preserves keyboard scrolling; final lint has not run after that adjustment.
- Latest ci:check: fails typecheck with the three diagnostics listed above.
- Latest full browser suite: 57 tests started, first chat test failed due to aiSettings;
  interrupted on the user's handoff instruction. No final suite result.
- The polling recovery regression is newly added and unexecuted.
- Production build has not run for this UI checkpoint.
- Physical mobile keyboard and screen-reader testing remain outstanding. Short-viewport
  and composition tests are browser simulations, not a real-device validation.

## Local evidence / recovery

- Backup ref backup/chat-db-20a0e37-20261002 resolves to the base SHA.
- Explicit non-secret UI patch and new test files: task/chat-ui-handoff-20261002.
- Before screenshots: task/chat-ui-evidence/before.
- Earlier passing screen captures: frontend/outputs/ui-ux/chat-after-{320,390,1440}-{ko,en}.png.
  Those images precede the final unfinished relocation. Account content is a local fixture.
- Logs: task/chat-ui-ci.log, chat-ui-unit.log, chat-ui-browser.log.
- No new Library upload IDs. Windows paths are not assumed available to the cloud PC.
- Local preview http://127.0.0.1:3112 was stopped during handoff.
- a.py and user data were untouched. No policy drafts, generated next-env change,
  environment files, credentials or unrelated user changes are part of this checkpoint.

Continue in cloud from this work branch when the user makes it available. Correct the
listed defects, then run frontend ci:check, build, and the complete fixture browser suite.
The source text and approval semantics must remain unchanged.
