# Custom agent pets — cloud handoff checkpoint

Base: `cfcaeb939129e290e7fbd8ae115414d44f361e5f` (`codex/workspace-credit-integration-20261004`). Work branch: `codex/custom-agent-pets-20261005`.

## Implemented, pending final verification

- One-prompt free preview, explicit review, save/select, multiple personal pets, conversational edits, archive/restore and archived-pet deletion.
- SVG appearance composition separated from arbitrary personality, communication, focus and responsibility preferences. Original requests remain reviewable, with bounded correction history and explicit consolidation.
- Workspace/user-scoped persistence, configurable server limits, revision conflicts, stable save retry IDs, transactional capacity checks and selection.
- Exactly one selected profile added to the existing run snapshot. Free-form preferences reach Python as untrusted data with fixed scope constraints. AUTO is a skill-catalog seam only.
- Labelled login examples replace the fixed three-character display. No provider call is made for preview or management.
- V44 migration and additive PetProfile/PetPreferences internal schema. Paid standalone generation guard remains unchanged and the UI reports it unavailable.

## Executed

- Backend source and test compilation succeeded before the last small service hardening/test addition.
- Targeted backend run completed successfully: `PetPromptComposerTest` (4), `AgentRunGatewayServiceTest` (17), `ApiRateLimitFilterTest` (5), all zero failures. `WorkspaceRbacPostgresTest` had 22 skipped tests because Docker was unavailable, including the two new pet lifecycle/concurrency cases. A Windows non-ASCII Gradle worker path error on the initial attempt was avoided by a temporary drive alias on the successful rerun; the alias was removed.
- Python: 69 tests passed across `test_custom_pet_preferences.py`, `api/test_pet_generation.py`, `runtime/test_executor.py` and `api/test_agent_runs.py`. Tests use fake providers; no paid model was called. Ruff passed on changed Python source/tests at that point.
- Frontend initial typecheck failed on missing `three` / `@playwright/test` dependencies in the reused original checkout dependency directory. That link was removed, and the worktree's lockfile dependencies were installed successfully with Node 22.14.0. No typecheck/build/browser test was run after this installation.
- Docker command: version/status query only. It reported no running Docker Desktop Linux engine. No engine start, restart, container run, image pull, data deletion or volume action was performed.

## Not executed / cloud next steps

The user stopped all further heavy laptop work. All started test/install sessions had already exited when the stop was processed. No development server or browser automation was started. No additional heavy checks may run on the laptop.

1. Run full backend tests in a cloud environment with PostgreSQL/Testcontainers available. The final `CustomAgentPetServiceTest` and the last serialized-profile length guard were added after the completed targeted backend run and have not been compiled or executed.
2. Verify real V44 migration, tenant isolation, concurrent active/storage limits, save replay/conflict semantics, membership revocation, select/archive/restore/delete and run snapshot/restart/resume behavior. Mock and serialization tests are not substitutes for these database checks.
3. With lockfile dependencies and Node 22, run typecheck, Node tests, ESLint, build and the new `custom-agent-pets.spec.mjs` browser suite. The browser tests are written but unexecuted, and no screenshot has been captured or reviewed. Check keyboard, mobile, cancelled preview, lost response and repeated save paths.
4. Validate the additive OpenAPI contract and schema compatibility with concurrent model/attachment branches. Re-run Python tests after all integration changes; the final fixed preference-rule wording was added after the passed run.
5. Review the security boundary end to end. The code keeps preferences out of authority settings; actual model compliance with arbitrary preference/prompt-injection text is not proven by serialization tests. Paid behavior/quality evaluation remains unexecuted and needs explicit authorization separately.
6. Keep paid profile/image generation disabled until the separate platform-ledger integration supports reservation, known/unknown usage reconciliation, cancellation, retry and idempotent settlement.

## Integration surfaces

V44 is reserved for pets. Likely conflicts: `frontend/app/lib/api.ts`, the pet-demo imports/region in `auth-gate.tsx`, `agent/src/contracts.py`, `agent/src/runtime/executor.py`, `contracts/openapi/agent-internal-api.yaml` and `ApiRateLimitFilter.java`. Pet components and the new backend companion classes are otherwise isolated. No skill catalog content, model tariffs, credit policy or attachment reader is duplicated.

No main merge, production deployment, paid API call or production data change occurred. This is a backup checkpoint, not a claim that the full feature is release-ready.
