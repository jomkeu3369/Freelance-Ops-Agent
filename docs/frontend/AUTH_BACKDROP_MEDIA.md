# Authentication backdrop media contract

`AuthBackdrop` owns the optional login-video lifecycle. `login-media.ts` selects an inspected same-origin MP4 and its matching first-frame poster. The moving background uses one native decoder; its short loop reset dissolve is baked into the file rather than rendered by a second video or a JavaScript animation loop. The generated forward camera path does not have matching endpoints, so this is a softened visible reset, not a geometrically seamless loop.

## Integration

Import `AuthBackdrop` from `features/workspace/auth/auth-backdrop`. Render the static decorative artwork as its children. Optional props:

- `sources`: explicit root-relative public asset paths, with MIME type `video/mp4` or `video/webm`, in preferred order
- `poster`: explicit root-relative matching first-frame path for loading/automatic visibility pauses
- `staticPoster`: earlier approved static artwork for manual pause, reduced motion, data saving, refusal or error
- `pauseLabel` / `resumeLabel`: localized button labels; English defaults are provided

Only connect inspected source bytes. Do not substitute a CDN or guessed generation URL. Verify format, browser decoding, the actual loop boundary, lack of audio, matching poster, byte budget and public asset paths before connecting a replacement. The delivered source is 1280×720 at 24 fps with no audio. The web derivative and frame-by-frame loop QA are recorded beside the media assets; do not describe the clip as 60 fps.

Login-specific CSS is owned by `auth-cinematic.css`: `.auth-backdrop`, `__visual`, `__fallback`, `__poster`, `__video` and `__toggle`. Layer fallback then poster then video. Use cover-fit media and the page's tint/vignette to keep the form readable. Keep the real button above the decorative visual layer and keyboard-focusable; do not put `aria-hidden` or `pointer-events: none` on its ancestors. Video uses the native `hidden` attribute until actual playback; do not override `[hidden]` with a display rule. The root `data-media-state` is `absent`, `disabled`, `loading`, `playing`, `paused`, `blocked` or `error`.

The controller attaches no media source during SSR, reduced-motion or Save-Data. Initial hidden/offscreen media also defers loading. It pauses when hidden, offscreen or user-paused; preference changes cancel loading and detach sources. The bottom-left control is a single 44px emoji-only button with localized accessible name and tooltip. Explicit pause switches to the original GPT concept still; play resumes the Higgsfield clip. Automatic visibility pauses do not overwrite that user intent. Matching first-frame poster and original artwork remain available at every stage. Refused autoplay offers a user-triggered retry; decoding errors do not loop retries. Source changes/unmount clean up listeners, observers, loading and stale play promises. Equivalent source arrays preserve the user's pause selection.

## Verification

Run the focused Node test with Node 22:

`node --test --test-concurrency=1 tests/auth-media-policy.test.mjs`

The focused suite covers source restrictions, no-video mode, policy/preferences, viewport/document lifecycle, pause/resume, refusals, errors, stale promises, and teardown. `auth-cinematic.spec.mjs` also exercises native decoding and wrapping, pause persistence during form changes, reduced-motion and Save-Data no-download paths, a refused autoplay retry, unreadable-video fallback, offscreen pause/resume, and short-height mobile controls. All browser checks use local assets and synthetic data; no real account or generation service is contacted.
