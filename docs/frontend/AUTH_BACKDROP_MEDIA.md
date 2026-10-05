# Authentication backdrop media contract

`AuthBackdrop` is a pending-video integration layer. It ships with no video URL or video bytes. The approved Higgsfield asset is still a separate, pending deliverable; static artwork must not be described as the final video.

## Integration

Import `AuthBackdrop` from `features/workspace/auth/auth-backdrop`. Render the static decorative artwork as its children. Optional props:

- `sources`: explicit root-relative public asset paths, with MIME type `video/mp4` or `video/webm`, in preferred order
- `poster`: explicit root-relative still-image path
- `pauseLabel` / `resumeLabel`: localized button labels; English defaults are provided

Omit `sources` until the approved video actually exists. Do not substitute a CDN or guessed generation URL. After acquisition, verify format, browser decoding, seamless loop, lack of audio, poster, byte budget and public asset paths before connecting it. The requested concept is 8 seconds, 16:9, 1280×720, with the right 40% calm enough for the form; these are intent, not verified asset properties.

CSS is owned by `auth.css`: `.auth-backdrop`, `__visual`, `__fallback`, `__poster`, `__video` and `__toggle`. Layer fallback then poster then video. Use cover-fit media and the page's tint/vignette to keep the form readable. Keep the real button above the decorative visual layer and keyboard-focusable; do not put `aria-hidden` or `pointer-events: none` on its ancestors. Video uses the native `hidden` attribute until actual playback; do not override `[hidden]` with a display rule. The root `data-media-state` is `absent`, `disabled`, `loading`, `playing`, `paused`, `blocked` or `error`.

The controller attaches no media source during SSR, reduced-motion or Save-Data. Initial hidden/offscreen media also defers loading. It pauses when hidden, offscreen or user-paused; preference changes cancel loading and detach sources. Poster and static artwork remain behind the video at every stage and reappear on pause, refusal or error. Refused autoplay offers a user-triggered retry; decoding errors do not loop retries. Source changes/unmount clean up listeners, observers, loading and stale play promises. Equivalent source arrays preserve the user's pause selection.

## Verification

Run the focused Node test with Node 22:

`node --test --test-concurrency=1 tests/auth-media-policy.test.mjs`

The focused suite covers source restrictions, no-video mode, policy/preferences, viewport/document lifecycle, pause/resume, refusals, errors, stale promises, and teardown. Full auth flow, visual layout, accessibility, codec/decode, actual autoplay behavior and download-byte checks require the owning integration/browser suite and an approved real asset.
