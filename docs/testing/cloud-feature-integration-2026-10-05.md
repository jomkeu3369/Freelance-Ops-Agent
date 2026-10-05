# Cloud workspace feature integration — 2026-10-05

Work branch: `codex/cloud-feature-integration-20261005`.
Base: `cfcaeb939129e290e7fbd8ae115414d44f361e5f`.

This is a cloud-only implementation and verification checkpoint. It is not a
production deployment or a claim that the database/browser release gates passed.
No laptop workloads, Docker execution, paid provider requests, administrator
grants, budget increases, main merge or force push were performed.

## Integrated behavior

- Actual USD usage/admission and the final compact chat UI are combined. Ordinary
  starts no longer charge fixed model credits. Current spending/model switches,
  durable reservations, unknown-cost holds and backend authorization remain
  authoritative. Existing administrator credit settings are legacy controls.
- All 60 free built-in workflows are searchable in Korean/English, grouped into
  eight categories, and available in Auto or exact manual mode (including zero).
  At most three bodies enter an execution prompt; exclusions are task-local.
  User request, selection, attachments and workflow mode participate in retry
  identity. Skills cannot grant tools or change permissions/models/budgets.
- Auto uses deterministic local rules, with no extra paid routing call. Role labels,
  attached source text and pet preferences do not select workflows. Both structured
  generation and ReAct objectives receive the selected workflow bodies and safety
  boundaries. More than three matches are shown as deferred next-stage work, not
  silently loaded or represented as completed.
- Normal project chat uses AD_HOC mode, avoiding mandatory quotation scenarios for
  unrelated writing/design/research work. Existing explicit project analysis keeps
  its four-department workflow. Model quality remains unverified by paid calls.
- Multiple personal pets support preview, save/select, edits, archive/restore and
  removal. One selected pet's preferences are copied into a run as untrusted style
  and focus data. Appearance preview composes existing animal/color/accessory
  presets; it is not arbitrary AI image generation or a claim of full natural-
  language preference understanding. Paid standalone generation remains disabled.
- TXT/CSV preserve bounded source text; PDF text layers, JPG/PNG/GIF and scanned
  pages have bounded reading with free local OCR where needed. OCR is always
  partial and fallible. Up to three frames/text-empty PDF pages are sampled, with
  exact omissions reported. General image, chart, animation and layout understanding
  is not provided. Long paste becomes a local TXT attachment without trimming.
- Attachment extraction and sending remain distinct review steps. Original bytes
  are not stored. Staged extraction is owner/workspace/project scoped, expires after
  30 minutes and is consumed in the START transaction. Sent reference text remains
  in the existing conversation retention boundary. An attachment cannot authorize
  actions or affect privileged routing.
- Member administration includes signup/login information plus per-member exact
  USD snapshots and cursor history. Every read rechecks an active, verified actor's
  current MEMBERS_READ grant before target lookup or ledger access. Disabled target
  members remain auditable. No member grant is created implicitly.

## Source integrations and corrections

Original feature checkpoints: admin `b5ab4b6`, attachments `07eae54`, pets
`bf354ba`, catalog `6c734a0`. Final ledger `bb72158` and UI `ae4add2` are included.
The integration also includes free OCR and admin ledger work, full skill runtime
and chooser wiring, general chat mode, contract reconciliation and regressions.

UI merge conflicts were resolved by preserving attachment/paste handling and exact
retry identity while adopting USD eligibility and the simplified composer controls.
A real pet parser issue found by the combined Java tests was fixed: an explicit
label such as `말투:` after a sentence-ending period is now recognized.

Migrations V42/V43 (ledger), V44 (pets), V45 (attachments), V46 (member activity)
have distinct numbers. Skill choices use existing durable command storage, so no
V47 table or migration is needed.

## Cloud verification so far

- Full agent tests: 511 passed, 8 PostgreSQL-dependent skips
- Ruff: passed across all agent source/tests
- Strict Mypy: passed, 93 source files
- Catalog schema/content validator: 120 checks passed, 60 skills, 40 fixtures
- Actual offline routing acceptance cases: passed in the full agent suite
- Structured and ReAct captured-provider prompt tests: passed; selected workflows
  appear, unselected bodies do not, and existing authorization/billing gates remain
- Native reader suite: 56 focused tests passed, including real English/Korean OCR,
  JPG/PNG/GIF/scanned-PDF bytes and native descendant cleanup on cancellation
- Full backend XML: 441 total, 342 passed, 99 skipped, zero failures/errors,
  including 19 explicit skips from the dedicated attachment PostgreSQL suite.
  A subsequent fixture-only correction uses a catalogued synthetic model in
  WorkspaceRbacPostgresTest; genuine execution awaits Actions
- Python SDK: 2 passed
- Frozen release-policy artifact gate: passed; this consumes stored evaluation
  reports and is not a new paid provider evaluation
- Final integrated frontend under Node 22.23.3: typecheck, all 293 Node tests and
  ESLint passed. Tests include both-language React rendering, all 60 skill options,
  manual/exclusion/deferred-stage cases, exact immutable retry snapshots, custom
  pet-name preservation and partial OCR review controls
- Production frontend webpack build: passed. The normal Turbopack build hit the
  cloud worktree's external read-only node_modules symlink boundary, so the supported
  webpack build was used locally; Actions installs real local dependencies and
  exercises the normal build
- Browser fixture collection: 20 tests in the four new-feature suites collected
  successfully; collection is not browser execution. Actions also includes the
  existing composer and fullscreen suites

## Unverified release gates

1. Docker/PostgreSQL integration: Docker is unavailable on this cloud computer.
   Skipped Testcontainers/PostgreSQL cases are not passes. Run V42–V46 migration,
   cost settlement, admin revocation, pet ownership/concurrency and attachment
   transaction/expiry/quota cases in an authorized Docker-capable environment.
   GitHub Actions test-only execution was authorized; the candidate branch has
   narrowly scoped CI triggers, with results to be recorded after execution.
2. Browser: Chromium fails before the app at its Unix socket creation restriction;
   the supported cloud browser rejects localhost. No restriction was bypassed.
   Existing screenshots are earlier synthetic-fixture evidence, not evidence of
   this combined revision. Integrated browser fixtures remain unexecuted here.
   A test-only Actions Chromium job on this branch will build an ephemeral local
   app, use synthetic sessions and blocked external requests, and preserve reports.
3. No real Spring-to-Agent upload against a live database or authenticated admin
   service was exercised. Unit, HTTP mock and direct native-parser results are
   separate evidence and do not substitute for that end-to-end check.
4. OCR packaging was added to the Agent Dockerfile and CI dependencies; the Docker
   image itself was not built here. English/Korean coverage requires the included
   Tesseract language packs and Poppler binaries.
5. Provider access, paid output quality and full natural-image understanding were
   not tested. Spending stays disabled by default, and standalone paid generation
   remains fail-closed.

## First GitHub Actions run and corrections

Candidate `b44363b8148cc096fa4341700ed98c1a779759a6` started Backend run
`37268299662`, Agent run `37268299648`, and Frontend run `37268299647`.
These are genuine remote test executions, distinct from local skipped suites.

- Both Docker images built successfully; no image was pushed or deployed
- All eight Agent PostgreSQL integration tests executed and passed
- Browser execution reached 40 passes and one short-height viewport failure
- Backend execution exposed a real durable-command JSON error: the `isDefault`
  convenience method on SkillSelection serialized as an unsupported `default`
  property. It is now explicitly ignored; strict selection/internal-input JSON
  roundtrip tests cover Auto, manual and manual-empty cases
- Five disposable PostgreSQL test classes lacked schema creation in their fresh
  container configuration. They now opt in inside the tests, while production
  retains `spring.flyway.create-schemas=false`
- One attachment Mockito restub invoked the existing answer with matcher nulls.
  The fixture now uses doAnswer/doThrow without changing assertions
- An OCR cancellation test raced a reaped process between `/proc` existence and
  read. The probe now treats only missing/reaped processes as exited, and still
  propagates permission failures, with deterministic regressions
- The Agent CI language packages did not provide the Tesseract executable itself.
  CI now installs it explicitly and requires Tesseract, Poppler and both English/
  Korean language packs before tests. The zero-skip guard correctly rejected the
  incomplete initial native-OCR run

The initial remote run failed; corrected candidate verification is still pending.
A local full backend rerun after the JSON/schema/fixture fixes passed. Neither the
initial failures nor the pending corrected run are represented as a release pass.

The short-height correction preserves the original strict viewport assertion,
removes non-shrinkable conversation padding below 560px, keeps supplementary
controls scrollable within 20dvh, and constrains the project title to its grid cell.
The regression additionally covers expanded skill controls and an unsent attachment
while offline. Local Node 22 typecheck, 294 tests and lint passed after that change.
After the backend/OCR fixes, local checks passed again: Java 343 executed with 99
Docker-dependent skips; Python 516 executed with 8 PostgreSQL skips; Ruff passed.
The next remote run must confirm the complete corrected database and browser flows.

## Second GitHub Actions run

Candidate `a5abd1f585bb10f4aa6e8fbbda045f4c4ac40426` passed all Agent tests:
524 passed, zero skips, including all eight PostgreSQL and 26 OCR tests. Both
Docker images built. Frontend typecheck, lint, 294 tests and production build
passed; synthetic browser execution passed all 41 tests, including the corrected
short-height case. Attachment (19), member administration (8), pet/workspace (22)
and notice (21) PostgreSQL cases passed.

Backend overall remained failed: 23 cases in four older quota/spend fixture suites
reused one synthetic email, violating the existing normalized-email uniqueness
constraint. Fixture account creation now derives a unique @example.invalid email
from each generated account UUID. The production uniqueness constraint is unchanged.
The next candidate also captures the expanded offline 390x420 view as a browser
artifact, while retaining the strict geometry checks and external-network block.
