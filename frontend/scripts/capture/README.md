# Isolated white workspace demo

Source: `6bfe089af8f5f25c5c15d7e9f7b6a68962112f28`.
Branch: `codex/workspace-demo-capture-20261004`.

This harness uses the actual frontend and its existing synthetic chat fixture. It creates a fresh
browser context, selects Korean/light theme, inserts only synthetic project/history data and
fulfills API requests inside the browser. A final request guard blocks every destination except
the selected loopback frontend and the mocked API namespace; all WebSockets are closed.

No application sign-in, real backend, database, provider, camera, microphone or audio is used.
The fixture marker remains in the synthetic result text. This is a frontend demonstration,
not evidence of real AI execution or backend behavior.

## What was executed

- Three network guard unit checks passed (zero failures/skips).
- Node syntax check passed for `workspace-demo.mjs`.
- Existing installed dependencies were copied to this independent checkout. No installer,
  download, npm install or modification of the dependency source occurred.
- Actual frontend build, browser execution, screenshot preview, OBS recording, sustained FPS
  and render/encoder missed-frame measurement: **not executed**.

The last measured free RAM was 0.41GiB, so no build/browser/recording was started. The runtime
guard requires at least 3GiB free RAM and CPU load no higher than 65% before proceeding.
The local Next config limits build workers to one; Node heap is bounded at 768MiB.

## Later execution

Run the following from a new PowerShell child process so environment sanitization remains
confined to that process:

```powershell
powershell.exe -NoProfile -File .\scripts\capture\prepare-and-verify.ps1
```

It refuses an occupied port, clears inherited operational configuration, builds the isolated
frontend and briefly starts its own loopback server at port 3217. It then runs headless UI QA
with a white-background assertion, network/runtime checks and a measured three-second test
scroll. Only the server it started is stopped afterward.

Successful headless verification would produce these ignored local artifacts:

- `outputs/workspace-capture/workspace-white-preview.png`
- `outputs/workspace-capture/workspace-preview-verification.json`

They are **UI QA, not video capture**, and the JSON records capture FPS and missed frames as
unverified. No 60fps claim is inferred from screenshots or requestAnimationFrame counts.

`-Hold` opens a fresh visible browser and keeps it open for user-operated OBS or available
supported Windows UI tooling. It must not be invoked as a workaround for unavailable app UI
tools. The visible mode was not run in this task. The harness never configures or starts OBS.

Before actual recording, select only this disposable browser's client area in a dedicated OBS
profile/scene with all audio/camera/microphone sources removed. Perform a real 10-second
60fps rehearsal, then inspect OBS rendering/encoding missed-frame counters. Do not capture
terminals, the desktop, another app or another authenticated browser. Existing OBS settings
and the other WebGL task must remain untouched. Do not upload the outputs before review.
