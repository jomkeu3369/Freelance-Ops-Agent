# Centered login footer, 2026-10-05

Base: verified motion candidate `554fb14e0d90b0583d06ffd222434da9545ee692`.
Branch: `codex/login-footer-center-20261005`.

The existing slogan and operational-notice link are centered at the bottom of
the login screen. A document-flow flex column keeps the footer at the viewport
bottom when there is enough room, and below the form on smaller/keyboard-height
screens. It is not fixed over form controls. Symmetric side clearance separates
it from the bottom-left 44px video toggle; bottom padding and the toggle honor
safe-area insets.

Scope is limited to login composition and regression tests. Copy, right-hand
form, original-still/video selection, authentication, workspace menus and media
bytes are unchanged. No database migration or backend change is introduced.

The focused browser matrix covers Korean and English desktop, 320px and 390px
mobile, landscape, and short-height signup/document scrolling. It checks actual
rendered text centering, footer/form/control non-overlap, operational-notice link
reachability, and no horizontal clipping. CI saves screenshots for inspection.
The complete existing motion suite still checks pause-to-original-still and
play-to-video behavior. This cloud environment does not support local Chromium;
branch-only Frontend Actions performs browser execution and the production build.

Local verification passed on the final edited tree: 322 Node tests, TypeScript,
ESLint, and the normal production build through `npm run preview:check` using
Node 22 and a clean lockfile install. Browser results and screenshot inspection
are required from the exact published SHA before this change is called verified.

The first CI candidate exposed a pre-existing floating-control collision on
narrow/short forms (80 browser cases passed, three failed). At widths up to
760px the same 44px button now docks at the document footer's left side; it
remains at the viewport bottom when the page fits and below the form when it
needs scrolling. Wider screens retain the fixed bottom-left control. Strict
rectangle non-overlap assertions remain, and keyboard pause/play is repeated
after signup scrolling and returning to login.
