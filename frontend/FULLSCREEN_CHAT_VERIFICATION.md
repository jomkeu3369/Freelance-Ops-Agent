# Fullscreen project conversation

## Scope

- Based on main `4743d0d08676a60f373f4faaadb80c991c44d2ce`
- Restores the prior workspace, real chat history, quota/authentication UI, and safe pipeline drag-and-drop from `31f9456f6466d513175c44fc1e5f46189da4ae96`
- The project conversation occupies the available viewport. A centered reading column and bottom composer replace the boxed conversation
- Desktop project navigation can be fully collapsed. Small screens use a keyboard-contained project drawer
- Results, execution details, AI settings, and detailed usage open on demand. They do not occupy a permanent right column
- Korean/English, light/dark, reduced motion, exact draft text, IME input, and unavailable-server states remain explicit
- Review also fixed stale-send draft deletion, stacked-modal focus handling, and the icon-only mobile brand's accessible name

Public landing components, WebGL/scroll styles, both existing README files, package manifests/lockfile, backend, and deployment/security configuration are unchanged from the base. The one shared-stylesheet exception is the explicitly requested removal of the decorative left border from `.form-error`; its wording, alert semantics, readable color, and background remain intact. The new conversation error/attention styles also omit left accent bars. No production merge or deployment is included.

## Verified locally

On the final implementation:

- `npm run ci:check`: passed TypeScript, **212 unit tests**, and ESLint
- `npm run build`: passed optimized Next.js build and page generation
- `npm run test:ui -- --list`: discovers **265 browser tests** across 14 files
- `git diff --check`: passed

The available runtime was Node 24.19.0. The repository declares Node 22.x and its existing CI uses Node 22; npm emitted the corresponding engine warning. No package dependency version was changed.

The modal-stack unit tests execute the real transpiled focus-trap hook against a small DOM harness. They cover topmost-only Tab/Escape handling, returning to the underlying dialog, out-of-order dismissal, and restoration of body/inert state. They are not browser accessibility verification.

## Browser and visual verification remains pending

The Playwright browser launch failed before running assertions because the configured Chrome executable was absent at `/opt/google/chrome/chrome`. Installing the official Playwright Chromium runtime also failed because its download was not a valid complete ZIP archive. No browser launch restriction was bypassed.

There are **no new verified screenshots** for this implementation. The screenshot paths in the tests are intended outputs, not generated evidence. Backend end-to-end operation, physical mobile keyboard behavior, and real screen-reader behavior are also not verified by these local checks.

`tests/browser/fullscreen-chat.spec.mjs` adds synthetic-fixture coverage for:

- 320×568, 390×844, 640×800, 1280×800, 1440×900, and 844×390
- Header/input/send controls inside the viewport without scrolling them into view
- Independently scrolling history with stable composer position
- Long drafts and offline notices as the viewport shrinks and rotates
- On-demand result/settings/usage panels, Escape, focus restoration, and no unintended writes
- Mobile drawer dismissal, Back/Forward, and project-scoped drafts
- Korean/English × light/dark, with reduced motion
- Late send completion after leaving and returning to the same project
- Quota notices appearing above an already-open panel

All fixture names, email addresses, tokens, requests, and history are synthetic. Fixture tests do not establish that a deployed backend supports the relevant endpoints.

## Next verification step

In an authorized environment with a working Chrome/Chromium installation:

1. Start the frontend with `npm run dev -- --port 3100`
2. Run the focused suites:
   `npm run test:ui -- tests/browser/fullscreen-chat.spec.mjs tests/browser/chat-messenger.spec.mjs tests/browser/professional-workspace.spec.mjs tests/browser/agent-chat.spec.mjs tests/browser/free-usage.spec.mjs tests/browser/pipeline-drag.spec.mjs`
3. Inspect the viewport-only screenshots in `outputs/ui-ux/`
4. Run the remaining browser suites and separately verify the authorized backend's real chat/history, usage, and estimation-policy endpoints

`PLAYWRIGHT_BROWSER_CHANNEL` can select an already-installed supported browser channel; it defaults to `chrome`. `PLAYWRIGHT_BASE_URL` retains the existing local preview configuration.

Frontend CI currently runs for pull requests and pushes to main, not work-branch pushes. A backed-up branch alone does not imply CI or browser tests ran.
