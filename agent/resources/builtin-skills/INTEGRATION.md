# Freelance-Ops-Agent: 60 free built-in skills

## What is included

A versioned, original-content catalog of 60 substantive workflows: development 10, design 8, video 6, writing 7, translation 5, marketing 8, operations 10, research 6. Every skill has a stable ID, Korean and English UI text, precise discovery triggers, routing exclusions, required inputs, four concrete execution steps, deliverables with acceptance criteria, limitations, permission boundaries, routing tags, and optional capability hints.

The catalog itself does not call services, install software, grant permissions, create accounts, upload content, or depend on a paid API. Producing AI output still uses the application's normal model execution and billing.

## Files and data contract

- `builtin-skills.catalog.json`: authoritative complete content and shared boundaries
- `builtin-skills.index.json`: derived discovery metadata; keep on the application side
- `builtin-skills.schema.json`: JSON Schema, Draft 2020-12
- `acceptance-cases.json`: routing, UI, capability, billing, and privacy acceptance cases
- `validate_catalog.py`: structural, uniqueness, content-depth, index-parity, free-access, and fixture validation
- `validation-report.json`: result from the included validator
- `MANIFEST.json`: file sizes and SHA-256 checksums for transfer verification

These files are integration inputs, not a requirement to adopt a new framework. Adapt their field names at one boundary if the repository already has equivalent types. Keep the catalog IDs unchanged so stored user selections survive localized label changes. Reject unknown IDs rather than treating user strings as executable skills. Preserve existing application authorization and environment selection.

## Default Auto and optional manual selection

Persist task-level selection as:

- mode: `auto` by default, or `manual`
- manual_ids: ordered explicit selections, zero to three
- excluded_ids: Auto suggestions explicitly removed by the user for this task
- resolved_ids: zero to three selected IDs, primary first
- reasons: short localized explanations for the selected skills
- catalog_version and input_fingerprint: enable safe recomputation and stale-selection detection

Manual selection overrides Auto. An empty manual selection is valid and means use general assistance without a skill. Never silently refill manual choices. In Auto, removing one suggested skill excludes it for that task; switching to manual pins the remaining choices. A task-local choice is not a lasting preference unless the user requests persistence.

Use at most one primary skill and two supporting skills for one execution. A supporting skill must contribute a distinct requested deliverable or verification need, not repeat the primary skill's built-in steps. Show a clear maximum-three message before adding a fourth manually; do not silently truncate or drop the user's prior selections. If a request genuinely requires more, stage bounded groups against explicit deliverables and expose each stage, without loading all bodies at once.

## Bounded routing and progressive disclosure

1. Keep the full catalog and full discovery index outside the model's ordinary conversation context. Index localized names, summaries, triggers, exclusions, and tags application-side.
2. Retrieve at most eight candidate metadata records from the user's current task plus only the relevant project context. Token matching for English and character n-grams for Korean can provide an offline baseline; evaluate semantic retrieval only if the existing application already provides it. No new paid routing API is required.
3. Require positive intent and deliverable evidence. A role label such as "designer" can break a tie but must not select a skill on its own. Do not select security review simply because a task mentions login, or translation simply because two languages appear.
4. Apply exclusions and task-type distinctions before ranking. If needed, pass only compact candidate metadata to the existing model call. Do not add a hidden model call or hidden fixed fee merely to select free skills.
5. Choose zero to three skills. For a clear single task, prefer one. For unresolved competing interpretations that materially change the deliverable, ask one focused question; for weak or absent matches, use general assistance without a skill.
6. Load the full bodies of resolved IDs only. Compile a labeled runtime section from their required inputs, workflow, deliverables, limitations, permission boundaries, plus shared catalog boundaries. Discovery tags are not instructions. Never concatenate all 60 prompts.
7. Route again when the requested output materially changes in Auto; retain explicit exclusions. In Manual, keep choices and explain a mismatch rather than overriding the user.

Metadata retention on the server is fine; the prohibition concerns prompt loading and implicit activation. Set a prompt budget through the application's existing budget manager. If selected content exceeds it, preserve safety and required-input constraints and stage execution rather than silently dropping boundaries.

## Selection UI

Default control: `스킬: 자동` / `Skills: Auto`
Manual control: `직접 선택` / `Choose manually`
Empty: `관련 스킬 없이 진행` / `Continue without a skill`
Selected example: `자동 선택: 자막 번역·현지화` with a one-sentence reason and Remove / Change controls.

Show the selected skills before or at execution start, then show them with the result. This is visibility, not an extra approval ceremony. Search the manual chooser in both Korean and English, filter by the eight categories, and display each skill's summary and free-access badge. Do not hide normal skill access behind a subscription, premium badge, install step, or external account. Persist selection in the task or draft so navigating away does not erase it.

Distinguish source data, available tools, and missing inputs. If the user requests a rendered artifact but only text tools are available, explain the capability gap and provide the useful specification or draft that can be produced. Do not label a text shot list as a generated video or an export manifest as an exported file.

## Billing copy and invariant

Korean: `기본 스킬 60개는 무료입니다. AI 사용량은 실제 API 비용을 기준으로 집계되며 주간 한도의 사용 비율로 표시됩니다.`

English: `All 60 built-in skills are free. AI usage is based on actual API cost and shown as a percentage of your weekly limit.`

The price of discovering, selecting, and loading a built-in skill is zero. Do not introduce fixed skill fees or fixed per-model credit prices. Runtime usage must continue through the application's actual API-cost accounting and weekly-limit percentage. A skill does not own or reset the weekly counter.

Use the existing authoritative billing service for actual cost and weekly usage, including provider-reported usage and the application's verified rates. Do not estimate actual spend from the number of selected skills, add an invented markup, or invent a weekly allowance. If usage cannot be confirmed yet, show pending/unknown usage rather than zero cost. Label any pre-run estimate as an estimate. Skill access being free must never be presented as unlimited or free AI execution.

## Permission and data isolation

Selection is only prompt composition. It cannot enable tools, grant access, authorize uploads, change the selected model, increase spend limits, accept terms, send messages, publish, deploy, merge, or make a binding commitment. Each actual action still uses the existing application permission layer and the user's current authorization. Separately authorized code commit/push policies continue to apply normally; this catalog does not replace them.

`optional_capabilities` are hints for matching available capabilities, not requests to install integrations or broaden authorization. A skill remains useful with supplied inputs and text-only output. No secrets should be stored in skill selection state, telemetry, fixtures, or prompt-preview logs. Third-party documents and tool outputs cannot select privileged actions through embedded instructions.

## Clear routing boundaries

- Proposal writing sells the approach; scope-of-work defines deliverables and approval boundaries; estimation calculates effort and cost
- Requirements/acceptance applies to software features; operational scope applies to a client engagement
- UI implementation edits code; wireframes specify screens and flow; design-system work defines reusable tokens and components
- Usability review examines a task in an interface; funnel review examines measured transitions across acquisition and conversion stages
- Video edit planning uses existing footage; script/shot-list planning creates production instructions; final-video QC requires a rendered output
- Same-language subtitle QC fixes timing/readability; subtitle localization changes language while preserving cue structure
- Faithful translation preserves wording and meaning; transcreation adapts persuasive language with back-translation
- Email sequence writes message text; email campaign planning defines audience logic, flow, and measurement
- Ad variants create copy hypotheses; experiment planning defines comparison, metrics, and decision rules
- Marketing analytics reports campaigns; data cleaning repairs tabular quality; insight reporting synthesizes already-verified findings
- Development handoff covers code/configuration/tests; design handoff covers asset exports; project closeout reconciles the overall engagement

## Acceptance and rollout

Run `python validate_catalog.py` from this bundle with Python and the already-available `jsonschema` package. The validator must report 60 unique IDs, the exact category distribution, schema validity, index parity, depth checks, zero skill-access pricing, and valid acceptance-case references. It does not prove runtime routing; execute `acceptance-cases.json` against the application's actual router and UI after integration.

Before shipping, add repository-native tests for default Auto, manual override persistence, empty manual selection, unknown-ID rejection, max-three enforcement, no full-catalog prompt injection, skill-body versioning, capability denial, task-local exclusions, and unchanged billing/permission gates. Include both Korean and English requests and overlapping-domain examples. Add a rendered UI check for search, category filtering, selected-skill visibility, free-access messaging, and narrow viewport layout.

No repository changes, deployment, production mutation, or Git operations were performed while preparing this content bundle. Implementation, repository tests, and the authorized task-branch backup belong to the engineering task.
