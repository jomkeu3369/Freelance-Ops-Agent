# Prompt-created personal agent pets

## Current behavior

The login page shows explicitly labelled, selectable examples. It does not load another user's pets or claim to have generated an AI image. After login, open a project's **AI settings → 나만의 작은 동료 만들기**. Enter one short prompt, review the free preview, and choose **저장하고 선택**. Add more pets, select one for the next run, refine it with another sentence, archive it, restore it, or permanently remove an archived pet. Creation and management do not execute any AI model or external tool.

Appearance uses existing SVG animals, colors and accessories. The deterministic composer recognizes a limited vocabulary; it does not pretend to understand arbitrary language. The preview displays both the recognized presets and the original requests. Arbitrary preferences are retained as data. Explicit `성향:`, `말투:`, `중점:`, `업무:` (or personality/tone/focus/role) clauses separated by semicolons or newlines populate independent free-text fields. Later edits preserve earlier requests and replace explicitly labelled fields. After six requests, the user must explicitly consolidate the preferences into a new description; no request is silently truncated. The existing appearance remains during consolidation.

Saving selects exactly one pet. Restoring does not select or execute it. Archiving the selected pet clears the selection. A run with no selected personal pet uses the normal workflow. Existing accounts with no personal-pet selection retain the old three quotation-scenario profiles until their first custom pet is saved; old run snapshots still render. The number of stored pets does not multiply model calls, workers or paid execution.

## Data and runtime boundaries

- V44 adds `custom_agent_pet` and `custom_agent_pet_selection`, independently of V34's three quotation slots. Every read and write binds both workspace and authenticated user. Another workspace owner cannot access the personal pets. Current `agent.run` authorization is rechecked before every operation; a revoked membership cannot preview, save or select.
- POST save carries client-generated pet and mutation UUIDs plus an expected revision. Owner-scoped advisory transaction locks serialize capacity checks, saves, lifecycle changes and selections. A repeated identical save returns the same pet; reused mutation IDs with changed bodies and stale revisions fail with 409. IDs belonging to another tenant never overwrite a record.
- Counts are server enforced, including concurrent requests. Defaults: 8 active, 24 stored including archived, 500 characters per prompt and 6 preference requests. Configure `app.pets.max-active` (1–24), `app.pets.max-stored` (active limit–100), and `app.pets.max-prompt-length` (1–500). Limits are returned to the UI. Archiving frees an active slot; deletion frees storage. Existing API request throttling also covers the preview/save endpoints.
- The server snapshots the selected `PetProfile` into the existing agent-run request/outbox. The client cannot choose an arbitrary foreign pet in a run request. Resume uses the stored snapshot; changing, archiving or deleting a pet does not mutate prior runs.
- Appearance/name never become executable instructions. `PetPreferences` carries bounded personality, communication, focus, responsibility and ordered requests. Python passes these as `untrusted_pet_preferences` data, accompanied by a fixed rule limiting use to style and task emphasis in the current job. Fixed policy, authorization, tool allowlists, evidence rules, approval and run budgets stay independent. This boundary does not claim that natural-language prompt injection can be eliminated through wording alone; existing server authorization remains authoritative.
- `skillMode: AUTO` is the integration seam for the separately maintained free skill catalog. This change does not implement a duplicate catalog, select arbitrary executable tools or grant capabilities through skill names.

## API

All responses use `Cache-Control: no-store`; workspace prefix is `/api/v2/workspaces/{workspaceId}`.

| Method / path | Contract |
| --- | --- |
| GET `/agent-pets` | Personal collection, selection, limits and explicit free-preview/paid-generation availability |
| POST `/agent-pets/preview` | `{id, mutationId, expectedRevision, description, resetPreferences}` → unsaved profile |
| POST `/agent-pets` | Same input → saved pet and revision; explicitly selects this pet |
| PATCH `/agent-pets/{id}` | `{action: SELECT/ARCHIVE/RESTORE, expectedRevision}` |
| DELETE `/agent-pets/{id}?revision=…` | Deletes an archived, owner-scoped pet after UI confirmation |

Legacy `/pets` remains compatible for old profiles. The internal PetProfile contract adds optional petId/duty/skillMode/preferences; old payloads default safely. Free text is never used as a model/provider selection, permission code, credential, SQL fragment, URL or arbitrary SVG.

## Paid generation is still disabled

The existing standalone `/pet-generations` path and Python platform-spend guard are not bypassed. The new preview has no provider dependency and incurs no API cost. The UI reports `aiGenerationAvailable=false`. The current Spring legacy generation audit is not a durable reservation/settlement ledger and must not be treated as sufficient billing support.

Before enabling paid generation, integrate with the platform cost-ledger owner: bind a durable operation ID, authenticated tenant/user and versioned tariff; reserve before dispatch; use durable queued execution; reconcile known usage and unresolved provider outcomes; release only confirmed unused reservations; make cancellation, retries and idempotent settlement explicit. A timed-out provider call with unknown usage must not be refunded or automatically retried as if unused. A confirmed cancellation before dispatch can release its reservation; after dispatch it requires reconciliation. Preview/save must remain separate. Paid images require their own supported pricing and resource limits. Do not add image calls merely to render existing SVG appearances.

## Verification scope

Meaningful tests cover arbitrary preference retention, labelled edits, history bounds, wire round trips, untrusted-data placement, old profile compatibility, runtime snapshots, save retries, owner/workspace isolation, concurrent limits and lifecycle transitions. Browser fixtures exercise preview/cancel, lost-response save retry, selection/archive/restore, draft preservation, mobile width and the login examples. Browser fixtures do not replace real database tests. Real paid model behavior and deployed migrations are outside this task's authorized verification. See the accompanying implementation report for executed versus blocked checks.
