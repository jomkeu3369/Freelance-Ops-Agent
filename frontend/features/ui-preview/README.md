# Preview-only component story

This branch is a screenshot fixture, not a production release candidate.

Route: `/ui-preview/fullscreen-chat`

The story renders the real `WorkspaceChrome`, `ProjectStepNavigation`, and extracted `AgentChatSurface` with fixed synthetic data. It never creates a session, sends an AI request, reads a backend, or saves project data. Typing is in-memory only; submitting shows a preview explanation.

The server route is gated to local development or the exact `codex/fullscreen-chat-fixture-20261004` Vercel preview branch. Other preview branches and production builds return not found. The route is noindex/nofollow. No real authentication path is changed or bypassed.

The authenticated `AgentChat` still invokes its normal controller. Its surface JSX was extracted without changing the conversation markup; the fixture invokes only that presentation function.

Browser assertions are provided in `tests/browser/ui-fixture.spec.mjs`. A deployed browser screenshot is still necessary; unit/build success is not visual verification. Screenshots must be labeled as UI previews with synthetic data.

Local verification: TypeScript, ESLint, all 215 unit tests, and both preview and production builds passed. The preview build's HTML contains the real component story and label, with no session token. The production build emits HTTP 404 metadata and no fixture component. The extracted conversation JSX is byte-for-byte equal to the original after normalizing ref-variable aliases.
