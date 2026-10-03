# Gemini retirement verification — 2026-10-03

## Scope and compatibility

- New AI use in this revision supports OpenAI. Gemini generation, ReAct, pet, assumption and RAPTOR adapters are removed. The dormant Deep Agent string-provider allowlist no longer includes Google GenAI.
- Spring rejects new Gemini platform/BYOK model selections, credential saves/resolution, run resumes, pricing records, task execution profiles and RAPTOR requests before provider calls or associated writes. Agent HTTP endpoints independently reject Gemini with HTTP 400 / `AI_PROVIDER_UNSUPPORTED`; provider dispatch also fails closed before resolving keys.
- Frontend provider choices and environment model catalogs cannot enable Gemini. Historical connections remain visible as unsupported and can still be explicitly deleted by their owner. They cannot be selected for execution. Historical Gemini runs remain visible and cancellable; resume and AI quote assistance are unavailable. No automatic OpenAI fallback is introduced.
- Historical provider identifiers, database migrations, stored credentials, pricing and task/run records are retained. There is no database migration or credential deletion. The connection catalog retains `models.GEMINI: []` only so older clients can read its shape.
- The direct `google-genai` dependency is removed. Its package can still be present transitively through Deep Agents/LangChain; no product runtime adapter invokes it.
- Google OAuth and unrelated provider/research integrations are unchanged.

## Verification

- Agent: full pytest suite, Ruff, mypy and pinned release-policy gate. Database-dependent integration tests require PostgreSQL and are skipped locally.
- Frontend: TypeScript, unit/source regressions, ESLint and production build. New fixture browser tests cover retired connections, preserved OpenAI selection, settings delete/cancel, navigation and historical-run resume blocking.
- Backend tests cover retired provider rejection before key/HTTP access, empty legacy model catalog and preserved masked connection history. Local Gradle bootstrap is blocked by Java network access to the distribution, so compilation/tests are not claimed as passed.
- Local Chromium fixture tests cannot launch in this executor because Chromium process sockets are denied (`Operation not permitted`), including an approved escalated attempt. These browser tests must run in a browser-capable environment before release.
- Both OpenAPI YAML documents and Compose parse; whitespace checks pass. No real provider requests, production writes, secret inspection or stored-data migration were performed.

## Release checks still required

1. Run Spring compilation/full tests and database integrations, plus the new browser fixtures in a suitable environment.
2. Integrate signup-age and monthly-usage changes with their tests; this branch deliberately does not merge or deploy them.
3. Deploy frontend, backend and Agent together only with separate release approval. A frontend-only deployment does not close old server Gemini paths.
4. Check existing Gemini queued/waiting runs before rollout. They will stay readable/cancellable but cannot make another Gemini call after the Agent update. Do not delete credentials or alter historical records automatically.
5. Verify OpenAI platform/BYOK behavior using an approved non-production environment and synthetic or specifically authorized credentials. Retire unused Gemini deployment variables without exposing their values only as part of an authorized operations change.

This source revision is not evidence of a production deployment. Public provider/privacy statements must follow the separately verified production release.
