# Actual localhost workflow validation — 2026-10-14

Branch: `work/live-browser-workflow-20261014`, based on
`work/overnight-workflow-integration-20261014` at
`1bf28eeaeb71ddabf422e1f08e171f4aff674027`. The user checkout was not modified.
This record describes the working branch in an isolated local environment;
operating services still use an earlier version.

## Actual services and test boundary

- Chrome used a separate headless Playwright profile on **5FPC098**'s computer.
- Next: `127.0.0.1:18220`; Spring: `127.0.0.1:18221`;
  FastAPI Agent: `127.0.0.1:18223`.
- Independent PostgreSQL **17.11**, pgvector **0.8.7**:
  `127.0.0.1:18224`, `freelance_ops`, `app` and `agent_runtime` schemas.
  Official portable PGDG runtime was reused read/execute only; owned data was
  `/tmp/freelanceops-workflow-pg17-20261014/data`. All seven Agent migrations and
  all 52 Spring migrations were applied. Earlier PG18 diagnostic data is separate.
- Spring uses the actual `HttpAgentRunClient` and `AgentRunGatewayService`.
  FastAPI uses the actual JWT verifier, `OperationalAgentExecutor`,
  `RunCoordinator`, `SpringToolClient`, knowledge loader, checkpoints and PG store.
  Playwright's live tests do not install browser API route handlers.
- **Only external model generation is synthetic**. Provider requests, paid search
  requests and spending activation are zero. Synthetic provider responses contain
  three distinct role opinions and can fail exactly the DEAL_DESIGN department.
- Authentication uses ordinary register/login routes and the repository's existing
  in-memory test fixture. The private signing material is never written or
  printed. Only public verification material reaches the localhost Agent. The
  BYOK row is the existing never-decrypted fake fixture for synthetic
  `@example.invalid` users. Operational secrets and keys were not used.

## Changes and communication findings

| Integrated commit | Source | Purpose |
| --- | --- | --- |
| `e8d959e` | this session | Normalize Windows source line endings in a history check; configure API fixture origin for isolated ports |
| `95294d7` | `954899c` | Bound SSE connection and servlet lifetime |
| `cb9d3bc` | `776a510` | Isolate mutable REST builders and explicitly use HTTP/1.1/read timeout |
| `c6b1f39` | `17cf5f8` | Preserve queued acceptance receipt before Agent delivery |
| `8b60707` | `f7c7ac1` | Relay actual public `knowledge.retrieved` through completion |
| `72220eb` | `63e11f8` | Restrict localhost test peers and record transport evidence |
| `40f6b8c`, `2fbf11a`, `d118426` | `ef6d47b`, `3256fda`, `1e7f6e1` | Specification provenance/immutability tests and independent PDF verification record |
| `07dabb2` | this session | Keep polling after accepted clarification while the previous question snapshot is still visible |
| `31ebc76` | `817038d` | Treat only authorized, locally QUEUED + upstream SSE404 as an empty reconnectable stream |
| `cec3ec8` | this session | Reproducible actual browser/API/DB harness with sanitized evidence |
| `19a09da` | `24fe9c3` | Record original-token expiry, preserved work and rejected replay before the approved authentication update |
| `2974ccc` | `c9733fc` | Bound START/RESUME/tool execution to the original actor, permissions and first run deadline |
| `a979401` | `86433c0` | Preserve active resume state against the same already-answered late question snapshot |
| `0e387a7`, `7a7d1a1` | `1123b7d`, `446f04a` | Independent wall-clock authentication evidence and paired rollout/legacy-token boundary |
| `4cc023b` | this session | Type the existing fractional timeout calculation as float for Agent CI; no runtime policy change |
| `6b73e04` | this session | Limit live fixture ports and prevent bytecode writes to borrowed Python runtimes |

The actual connection found a shared `RestClient.Builder` configuration mutation,
unhandled queued reads/streams before outbox delivery, a missing public SSE event,
and the frontend's premature stop after clarification acceptance. Backend changes
were coordinated with its owner and cherry-picked. No design change was made.
The specification test now waits for route navigation before generating a draft;
`SpecificationPanel` production code was not changed.

The approved authentication update retains 60-second query/control tokens.
Only START/RESUME/tool execution receives `execution_deadline`, capped by the
original `run.createdAt + budget.maxDurationSeconds` and the existing BYOK cutoff.
Retry/resume does not renew the deadline. The original initiator and permission
snapshot, current membership/permissions and active run/project are checked.
WAITING itself is not admitted for tool execution. A known RESPONDED interruption
with the same run/workspace/ID/questions cannot revert QUEUED/RUNNING; a new or
different question still produces a genuine WAITING state. These auth changes
introduce **zero additional DB migrations**.

## Verified journeys

Three browser cases select **one**, **two** and **three** opinions; the third uses
a 390×844 mobile viewport. Each verifies:

1. Actual login with duplicate click protection, customer creation and linked
   project intake.
2. Pet composition/selection, one persisted pet despite duplicate clicks, reload,
   desktop mouse gaze and neutral touch behavior.
3. An ordinary project question, full analysis, persisted clarification after
   refresh, actual answer submission and completed four-department execution.
4. Three recorded opinions, 1–3 selection, edited immutable decision revision and
   explicit confirmation; edited immutable specification revision and confirmation.
5. Foreign-user artifact/PDF rejection, actual PDF response/download, exact final
   text after reload and the same project's confirmed reusable material.
6. Exactly two runs, one confirmed decision and no duplicate login request;
   no page error or browser API 5xx response.

Two additional cases using real APIs verify:

- Model failure in DEAL_DESIGN preserves REQUIREMENTS/RESEARCH summaries,
  identifies failed/skipped stages, returns PARTIAL, and rejects composition with
  HTTP409. The browser reloads the actual saved partial result and displays its
  incomplete-state warning without a confirmation action. A completed run replay
  preserves its run ID/history; changed original
  project requirements reject old-source confirmation with HTTP409 and preserve
  the draft.
- Foreign workspace/customer/project/pet/artifact requests return 403/404. A pet
  UUID collision returns 409 without modifying the owner's revision or adding an
  intruder pet.

## Local results

| Suite | Passed | Failed | Skipped | Evidence class |
| --- | ---: | ---: | ---: | --- |
| Frontend node tests | 533 | 0 | 0 | Unit/source checks |
| Decision/specification/gaze/continuity Playwright | 28 | 0 | 0 | Controlled browser API fixtures; **not actual server evidence** |
| Live Playwright | 5 | 0 | 0 | Three whole browser journeys, one browser/API boundary case, one API tenant case |
| Java auth/transport/gateway/projection/architecture | 129 | 0 | 0 | Final combined local boundaries |
| Initial Docker ConnectedWorkflow baseline | 0 | 0 | 7 | Docker engine unavailable; not counted as passed |

Frontend lint/typecheck, Agent mypy with the Linux CI platform (96 source files),
and live-support Ruff check/format passed. Java live
launcher compiled and actual readiness endpoints returned 200/UP. Repeated runs
are not added to these totals. Independent backend and PDF session counts remain
in their own records, rather than being counted again here.
The local Next production build also passed; the production frontend was used
for the final five-case live-suite run after both `c9733fc` and `86433c0` were
integrated and Spring/Agent restarted. Each browser journey recorded **zero
page errors and zero browser API 5xx** responses. Downloaded PDF files and their
SHA256 hashes are retained alongside the sanitized HTTP records.

The server owner's separate wall-clock fixture showed completion after the old
60-second token's expiry, and timeout at the first 180-second cutoff with saved
work preserved. Its model and business repository/audit data were synthetic,
although JWT filter/controller, executor, HTTP and PG17 were actual components;
it is **not** a whole Spring application/browser run. See
`docs/operations/bounded-execution-auth-validation-2026-10-14.md` for that evidence.
The short whole-application browser cases here complement it and do not claim to
exercise the 180-second boundary themselves.

The first final PG17 PDF request returned the defined missing-font **503** while
preserving the confirmed text. Copying the existing Pretendard 1.3.9 static
alternative TTF to **build resources only** then produced an actual `%PDF-`
browser download. SHA256:
`6d0af5258997aec7354a6e340fc2325ba321c410ca48b3af858c8c3d6e92a324`.
The TTF is not tracked or uploaded. Remote PDF resource readiness is not claimed.

## Inspectable evidence and reproduction

- Harness/instructions: `tests/live-workflow/README.md`.
- Live tests: `frontend/tests/live-browser/`,
  `frontend/playwright.live.config.mjs`.
- Sanitized method/path/status evidence, outcome, result IDs and JUnit:
  `frontend/outputs/live-workflow/` (ignored local files).
- Actual persisted run status, public event IDs/types and confirmed revision/hash:
  `.tmp/live-workflow/database-evidence.json`.
- Actual Spring class names and zero provider request counter:
  `.tmp/live-workflow/real-components.json`,
  `.tmp/live-workflow/synthetic-model-calls.json`.
- Evidence before the approved authentication renewal change is retained separately
  under `.tmp/live-workflow/pre-renewal/` and
  `.tmp/live-workflow/pre-auth-production/`.

Auth headers, tokens and auth response bodies are excluded from traffic artifacts.
Browser trace/video capture is disabled. No stored delegation request JSON or
operational credentials are read by the DB evidence collector.

## Remote status and approval boundary

The dedicated branch was pushed. At `cec3ec8`, GitHub's combined status showed the
existing Vercel preview **success**; the preview was not used to verify the
connected workflow. GitHub Actions PR-triggered workflow runs were empty, and
this branch is absent from the workflow push allowlists.

The initial attempted action was to create a **draft PR** from
`work/live-browser-workflow-20261014` to
`work/overnight-workflow-integration-20261014` in
`jomkeu3369/Freelance-Ops-Agent` to run remote CI. **Denied, not executed**:
automatic approval review rejected the external repository PR creation because
explicit PR authorization was missing. After the user explicitly approved it,
the same request was retried **once** and succeeded as
[draft PR #74](https://github.com/jomkeu3369/Freelance-Ops-Agent/pull/74), attached to
this task. No workaround was used. At its initial `e01c087` head, Frontend CI
and Agent CI succeeded; Backend CI failed in PDF renderer and connected PDF
acceptance tests. The source font is intentionally absent pending separate upload
approval; local build-resource recovery does not resolve the remote failure.

The user subsequently approved finished work for operating rollout. This session
has not merged main or deployed: the final candidate and test results must be
coordinated with the parent and operating preflight first. The whole branch
currently includes incomplete remote PDF acceptance and cannot be reported as
ready for a complete rollout.

Current main Auto CD updates Agent before Backend and rolls back one service at a
time. New Agent START/RESUME rejects old deadline-less Spring tokens with 403;
there is no safe legacy-token fallback because old execution and control tokens
have indistinguishable authenticated claims. Freeze new execution/dispatch,
drain within original bounds or explicitly cancel current work, obtain a fresh
backup and validate a **paired Spring/Agent switch and paired rollback** before
activation. Preserve durable results, budgets and attempt counters; do not create
a paid replay by restarting. V49–V52 feature migrations need their own fresh
backup/restore evidence; the previous V48 rollback drill does not establish it.

Font publication remains separately pending approval. No fresh operating backup,
image fingerprint or paired rollback evidence was produced in this local session.
A UI/transport-only rollout would require a separate candidate and compatibility
CI against the operating baseline. No force push, spending activation, operational
credential issuance or authentication relaxation was performed.
