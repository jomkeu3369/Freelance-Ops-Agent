# Login motion candidate, 2026-10-05

Base: login layout checkpoint `67dbab50aedec7ab7cbfe7fa6227b4a70c4e86bf`.
Branch: `codex/login-pet-motion-20261005`.

The delivered forward camera clip is integrated through the existing one-video
lifecycle, with a matching first-frame poster and an offline four-frame reset
dissolve. No generation service or account is called at runtime. The existing
layout, left home brand, authentication behavior, and natural document scrolling
are unchanged.

## Inspected media

- Original: 1280×720, 24 fps, 193 frames, 8.041667 seconds, no audio, 6,110,614 bytes
- Web: H.264/yuv420p, 1280×720, 24 fps, 189 frames, 7.875 seconds, no audio,
  1,750,652 bytes (71.35% smaller), faststart metadata before payload
- Matching first-frame WebP: 35,266 bytes
- Order: source 4–188, then source 189–192 dissolved into source 0–3
- The actual file boundary goes from source frame 3 back to source frame 4
- An eight-frame dissolve was rejected because of prolonged overlapping pets
- The four-frame version retains two briefly mixed frames; the camera reset is
  still visible. Do not describe it as seamless or 60 fps
- All 189 encoded frames decoded; final decoded boundary luma MAE 1.36/255,
  adjacent-frame median 2.05/255. The dissolve region peaks at 5.78/255, so the
  low boundary metric alone is not evidence of imperceptible looping

## Verification scope

Node tests check asset hash/byte budget and MP4 faststart structure as well as
existing lifecycle, source restrictions, and layout invariants. New synthetic
browser cases exercise actual playback and native wrapping, pause persistence,
reduced-motion and Save-Data no-download paths, refused autoplay retry, corrupt
media fallback, offscreen pause/resume, and short-height mobile control placement.

Local Chromium remains restricted by this cloud environment. Browser decoding,
final screenshot review, and normal production build must pass the branch-only
GitHub Actions job on the published candidate. The user accepted the clip and requested the final emoji-only control before
publication. No production change is made by this motion work branch.

Initial candidate verification passed before the final control refinement: 316 Node tests,
TypeScript, ESLint (zero errors/warnings), and the supported webpack production
build. Browser tests were authored but not run locally; they are not counted as
passed. The final refinement adds a single bottom-left, localized, keyboard-accessible
44px emoji pause/play control. Manual pause shows the earlier approved GPT
concept image; play resumes the actual generated video. Offscreen/hidden
automatic pauses preserve explicit user intent. The released candidate must be
verified by Actions before promotion.

Final control refinement passed 320 Node tests, TypeScript and ESLint locally.
Test-only branch push triggers cover Frontend/browser, Backend/PostgreSQL,
Agent/PostgreSQL/OCR and Contracts/Compose on one exact motion-candidate SHA.
The OpenAPI 422 description is quoted, matching the separately reviewed release
stage fix. Deployment workflows are unchanged.
