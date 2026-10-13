# Workspace pets and recorded perspectives

The product pets are visual companions and bounded task preferences. They do not
create more provider calls, tools, credentials, parallel agents, or spending
permission.

## Pointer gaze

- `pet-gaze.mjs` owns the pure viewport-to-SVG coordinate conversion and one shared
  passive listener set. Pointer movement is coalesced into at most one animation
  frame for all mounted portraits.
- `use-pet-gaze.ts` subscribes a mounted SVG and cleans it up. `PetArt` preserves
  the existing animal, palette, accessories, and run-state artwork. Only the
  `pet-eyes` group moves, within four horizontal and 2.5 vertical SVG units.
- Reduced-motion preference, coarse primary pointers, touch input, dragging,
  pointer exit, document hiding, page exit, and blur return the eyes to neutral.
  Scroll and resize recompute viewport geometry without changing React state.
- The login poster remains static because it is a single raster image, without
  a separate eye layer. Saved/custom SVG pets use the shared gaze behavior.

## Recorded source attribution

A run stores its `metadata.petProfiles` snapshot. The agent's existing
`pet_perspective_instructions` preserves the baseline LEAN / RECOMMENDED /
EXPANDED perspectives and customizes the matching `profile.slot`. Accordingly,
`advisorsWithProfiles` matches a recorded profile by that exact slot. It does not
copy the first personal pet into all three cards. Scope cards are explicitly
presented as perspectives from one analysis.

`PetWorkspace` uses actual department results and run status. It labels each
visible source department and its state. Completed overall runs do not imply
that every department ran. Missing recorded opinions keep their missing-opinion
message; the UI never supplies generated-looking opinion text.

## Two distinct review paths

The existing `PetCouncil` combines individual quotation work items. Its checkboxes
are tied to the project, recorded scenario, opinion, and exact item content, so a
replacement source draft cannot inherit an earlier selection by array position.
Amount preview is a server calculation. Applying a preview only replaces the
local edit draft; saving and issuing still require their existing explicit steps.

The analysis decision review is a separate feature for selecting complete
recorded perspectives, assembling a synthesis, and confirming the user's result.
It owns its run/opinion IDs and persisted source provenance. PetCouncil does not
claim to provide that persisted decision path.

## Verification

- `tests/pet-gaze.test.mjs`: bounded coordinates, invalid geometry, frame
  coalescing, shared listener cleanup, reduced motion, pointer capabilities,
  lifecycle, scrolling, dragging, and touch on fine-pointer hardware.
- `tests/pet-state.test.mjs`: department state, exact slot attribution, and source
  item selection identity.
- `tests/pet-council-contract.test.mjs`: real component/profile mapping, absent
  opinions, replacement drafts, read-only access, duplicate work, and explicit
  preview/application boundaries.
- `tests/browser/pet-gaze.spec.mjs`: real Chromium mouse movement on all three
  animals, unchanged artwork bounds, motion preference changes, mobile touch,
  navigation/logout cleanup, native dragging, and synthetic hybrid touch events.
  All API/session data are synthetic; non-local requests are blocked and no
  provider run is started.
