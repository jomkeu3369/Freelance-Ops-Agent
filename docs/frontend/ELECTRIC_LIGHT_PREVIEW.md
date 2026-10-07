# Hero light comparison and rollback

This change develops the large curved background light bundle. The reference is
[the supplied Instagram reel](https://www.instagram.com/reel/Dd9nhiOyrZU/): fine
filaments, broad light envelopes, and luminous regions moving through a smooth
curve. The recording does not establish the original pointer implementation;
local repulsion and its damped return are this project's interpretation.

## Compare

- `/`: electric light with grouped travelling currents, violet/blue depth,
  diffuse wakes, and local pointer response.
- `/?hero-light=classic`: the previous light renderer on the same page.
- Mobile and reduced-motion preferences receive a static frame. Offscreen and
  hidden scenes stop rendering. Existing SVG art remains the WebGL fallback.

The new light uses one merged mesh/material. Its convergence is attenuated to
preserve strand detail, and pointer input never changes layout or captures clicks.
The footer continues using the classic renderer.

## Rollback

- The unchanged baseline is commit `a3b7719af6af4b7969b02bbc05d14459f2c8ab26`
  on `codex/refine-workflow-surfaces` (PR #56).
- This experiment is isolated on `codex/electric-hero-ribbon`, based on that
  branch. Review its incremental diff against PR #56, not against current main.
- Use the classic URL for immediate visual comparison. To withdraw the release,
  revert the electric-light commit; no data or migration is involved. This keeps
  the independent workflow-surface improvements in PR #56.
- These changes are for preview review. Production promotion follows approval
  of the preview revision as described in `DESIGN_IMPLEMENTATION_WORKFLOW.md`.

## Validation

`tests/browser/electric-light.spec.mjs` checks real rendered pixel changes,
localized pointer response, reduced-motion/mobile static rendering, the classic
comparison URL, and offscreen/hidden-tab suspension. Existing landing WebGL and
scroll-unfold browser suites cover the surrounding product experience.
