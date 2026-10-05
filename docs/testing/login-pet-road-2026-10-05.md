# Login pet-path composition — 2026-10-05

Branch: `codex/login-pet-road-20261005`, based on green integration commit
`81ead5fdd94b98e83f4e5fe4daf8a558c4fe4b02`. That baseline remains unchanged.

## Requested and implemented

- Full-bleed pet-path background with a separate right-hand login panel
- The approved concept image is the current real static poster. Its pixels were
  inspected before optimization; only proportional resizing/compression changed
- Language, product link and theme controls share a quiet, rounded header surface
- The exact Korean demo-disclaimer sentence and its English version were removed
  from rendered code and the translation dictionary, rather than hidden with CSS
- The old demo card/marketing overlay no longer covers the pets
- Mobile/short screens prioritize the form and keep registration vertically
  scrollable; verification/admin pages retain their previous auth layout
- Existing login, registration, age attestation, password visibility, pending
  verification, errors, duplicate-submit guard and session handoff are untouched

## Media hook

`AuthBackdrop` accepts only explicit root-relative sources and a poster. There are
no video sources configured yet. It prepares muted/autoplay/loop/playsInline,
reduced-motion and Save-Data gating, viewport/document visibility pause, explicit
user pause/resume, rejected-autoplay fallback, source failure handling and cleanup.
No video, provider call or paid generation is performed by this code. The future
moving asset must be delivered and inspected separately; the current poster must
not be described as a generated video or rendered Blender animation.

## Verification

Initial Node22 checks passed: 313 tests, typecheck and ESLint. This includes 15
focused media-policy/lifecycle tests. Final poster/layout checks and the browser
fixtures are being run against the work branch. Browser evidence uses synthetic
accounts and blocked external requests; no live login or account creation occurs.

The frontend CI push trigger is narrowly extended to this task branch, retaining
the existing main/integration behavior and adding auth error/layout scenarios to
the synthetic Chromium job. Backend/Agent/CD workflows are not changed. No laptop
work, main merge, production deployment, admin grant or spending activation occurs.

## First hosted check

Preview commit `378708e` passed all 313 Node checks/typecheck/lint and 57 browser
cases, but the two desktop position checks failed. Pixel review showed the old
white split-card covering the approved scene: equal-specificity base auth styles
could win by CSS chunk order. Cinematic rules now include the two-class page root,
which reliably outranks the base sheet. The original position assertions remain,
with added computed checks for transparent/borderless/shadowless outer layout and
successful poster decoding. This is being rerun before claiming visual completion.
