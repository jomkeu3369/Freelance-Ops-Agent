# Built-in skills integration handoff (2026-10-05)

Status: **content import and investigation only; feature implementation is incomplete**.
Laptop execution was paused at the user's request. Continue builds, runtime tests,
browser verification and Docker work in an authorized cloud environment.

## Verified input

- Library ID: `libfile_6f207b3bf1348191b7a857d111da2e2b`
- ZIP: `freelance-ops-builtins-v1.zip`, 68,460 bytes
- SHA-256: `625e29d4612a4b92de317371fd13e0d336818e98a3015f8d2efd61aa2cbc592e`
- Materialized with the current, unmodified Library transfer helper in this
  consumer environment. Windows Python failed because `os.setxattr` is absent.
  The installed local WSL environment with workspace-scoped Python 3.12 succeeded
  and the helper applied/verified Library metadata. No other cloud filesystem
  paths or guessed download URLs were used.
- Locally verified all seven `MANIFEST.json` byte counts and SHA-256 checksums.
- Original 60-skill catalog, schema, discovery index, notes, validator, 40 acceptance
  fixtures and supplied validation report are in `agent/resources/builtin-skills`.
- `bodies/*.json` and `policy.json` are generated projections of the original
  catalog. Frontend metadata and `BuiltinSkillIds.java` are generated projections.
- `routing.json` is an **untested initial routing-rule draft**, not connected to
  any runtime or UI. Do not treat it as accepted routing behavior.

## Verification boundaries

The supplied `validation-report.json` records the content author's 120 checks.
It was retained unchanged; the validator has **not** been rerun in this checkout.
The local manifest/hash checks are separate from that supplied report.
No implementation, contract, runtime, billing, authorization, UI, or visual tests
have been run. No paid model API was called. No migration was created.

The local `uv sync --locked --project repo/agent` installed test dependencies;
no pytest, ruff, mypy, frontend build, Java build, or browser automation was
started. A stop was sent when the pause instruction arrived; the install process
had already exited successfully. Docker commands were read-only `docker version`
queries, which reported no engine; no Docker start/restart/container commands ran.

## Base and scope

- Repository: `jomkeu3369/Freelance-Ops-Agent`
- Base: `codex/workspace-credit-integration-20261004`
- Base SHA: `cfcaeb939129e290e7fbd8ae115414d44f361e5f`
- Work branch: `codex/builtin-job-skills-20261005`, independent local clone
- `.agents/skills` and tracked `AGENTS.md` are absent at this base. Read agent,
  frontend, contracts README and CI test instructions. The sibling UI checkout's
  generated frontend AGENTS requires local Next.js docs before frontend edits.
- Implementation/test/task-branch commit/push are authorized. Main merge,
  production deployment, paid API use and permission grants are not authorized.
- V42/V43 model ledger, V44 pets, V45 attachments and V46 admin are reserved.
  Use V47 only if skills need a new database migration; request-scoped selection
  can use the already persisted internal command/run input without a new table.

## Integration map and proposed boundary (not implemented)

Keep a distinct `skillSelection` request field: `mode` (AUTO default / MANUAL),
`manualIds` (0–3), `excludedIds`, optional role/category preference, pinned
`catalogVersion`. An empty manual selection means general assistance; do not
refill it. Validate IDs against the catalog, never interpret them as file paths.

Likely shared files, coordinate with the parent before edits:

- Frontend `app/lib/api.ts`, `pending-run-store.ts`, workspace shell, project
  workbench, and agent-chat composer connection. Keep the actual chooser in
  `features/workspace/skills` to minimize layout conflicts.
- Backend `StartAgentRunRequest`, `InternalAgentRunRequest`,
  `AgentRunGatewayService`, `AgentRunView` and possibly `FreeUsageService`.
- Agent `src/contracts.py`, `runtime/executor.py`; a separate skills module
  should own validation, resolution, body loading and bounded prompt compilation.
- `contracts/openapi/agent-internal-api.yaml` and repository-native cross-service
  fixtures/tests must agree.

The actual run path is `startAgentRun` -> `StartAgentRunRequest` -> gateway ->
`InternalAgentRunRequest.AgentInput` -> Python `AgentInput` ->
`OperationalAgentExecutor`. Both `_department_prompt` (structured generation)
and `_execute_react_departments` (ReAct objective) need the selected content.
Do not stop at a selector-only UI. Assert body presence in captured actual provider
prompts in both execution paths, and absence of unselected skill bodies.

`PendingRunStore` currently signs only owner/project/model/message, not skills.
Adding selection requires a snapshot and signature update so an ambiguous retry
cannot silently reuse a different choice. `FreeUsageService.requestHash` retains
a legacy unquoted-request hash; preserve existing AUTO/no-selection idempotency
compatibility while including nondefault selections in the hash.

Pet work is separately introducing `PetPreferences` with personality,
communication, focus, responsibility and up to six conversation requests, and
only one selected pet. Combine the skill selection with that profile as prompt
data, without implicitly adding tools or effective permissions. Coordinate its
`skillMode AUTO` junction with the parent/pet task before integration.

## Remaining acceptance work

1. Run the supplied validator and actual router against all routing fixtures;
   assess staging and every other acceptance case separately. Broad regex
   matching can overselect, so review negative intent and overlapping domains.
2. Auto must be offline or use existing calls, require task/deliverable evidence,
   and use at most three selected bodies per prompt. Role alone is not intent.
   Keep index/full catalog outside ordinary model context. Show reasons,
   exclusions, manual mismatch and any deferred stages honestly.
3. Localized KO/EN chooser: default Auto, bilingual search, eight categories,
   manual maximum three, empty selection, removal, draft persistence, current
   selections visible at execution and with saved results, narrow viewport QA.
4. Preserve shared and per-skill limitations and boundaries. State unsupported
   file/media rendering, web search, external writes and missing evidence.
   Selection is prompt composition only; no plugins, dynamic code or tool grants.
5. Skill access costs zero. The separate model-ledger task owns actual API-cost
   accounting and weekly-limit percentage. Preserve its budget and billing gates;
   do not claim unlimited/free model execution or reset usage on skill changes.
6. Add/run native contract/runtime/UI tests and visual checks in cloud, then
   report content checks, actual execution tests and visuals as distinct evidence.
