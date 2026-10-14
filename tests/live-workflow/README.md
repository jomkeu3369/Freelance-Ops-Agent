# Actual localhost workflow verification

This harness connects a real Next frontend, Spring backend, FastAPI Agent and
isolated PostgreSQL with pgvector. It does not intercept browser API routes or
replace the Spring gateway, authentication, JWT verifier, executor, tools,
checkpoints or database. Only the external model adapter returns synthetic data;
no provider requests, search requests or spending activation are required.

Use a disposable clone and an existing **test-only** fixture. `LiveBackend` reuses
the in-memory signing fixture in `ConnectedWorkflowPostgresTest`; its private key
is never printed or written. The public verification material is kept in ignored
`.tmp/live-workflow/`. Register/login use the ordinary application endpoints.
`seed-test-connection.py` inserts the existing never-decrypted fake BYOK row only
for registered `@example.invalid` test users. Do not use operational credentials.

## Services

Create a dedicated PostgreSQL 17 database with `app` and `agent_runtime` schemas,
`vector` and `btree_gist` extensions. Bind it to `127.0.0.1:18224`. Apply the Agent
Alembic migrations with its ordinary locked environment; Spring runs Flyway on
startup. Docker or a user-local portable PostgreSQL runtime both work. Do not
delete shared containers, change OS services or reuse another session's data.

Start Spring from `backend/` with Java 21 and the following environment:

```text
APP_ENVIRONMENT=test
SERVER_ADDRESS=127.0.0.1
SERVER_PORT=18221
DB_URL=jdbc:postgresql://127.0.0.1:18224/freelance_ops
DB_USERNAME=app_user
APP_CORS_ALLOWED_ORIGINS=http://127.0.0.1:18220
APP_RATE_LIMIT_ENABLED=false
AGENT_BASE_URL=http://127.0.0.1:18223
APP_BYOK_ENCRYPTION_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=
```

The encryption value above is the repository's existing test-only fixture.
Supply only your disposable local database's password if needed. Run:

```text
gradlew --init-script ../tests/live-workflow/live-backend.init.gradle liveBackend --no-configuration-cache --no-daemon
```

After Spring is ready, start the Agent from the repository root using the locked
Agent Python runtime and `LIVE_DATABASE_URL` set to
`postgresql://app_user@127.0.0.1:18224/freelance_ops`:

```text
python tests/live-workflow/synthetic-agent.py .tmp/live-workflow/test-public.pem
```

Start Next from `frontend/` with
`NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:18221`:

```text
npm run dev -- --hostname 127.0.0.1 --port 18220
```

To verify the local production frontend, stop the development process first,
then use `npm run build` and
`npm run start -- --hostname 127.0.0.1 --port 18220` with the same public API URL.
This is a local build/run; it does not publish a hosted deployment.

Restarting Spring refreshes its memory-only fixture: restart the Agent afterward.
Wait for both readiness endpoints to return 200 before running Playwright.

## Playwright

Run in `frontend/` with these environment variables (resolve filesystem paths
against your own clone/runtime):

```text
PLAYWRIGHT_LIVE_MODELS=synthetic-provider
PLAYWRIGHT_BASE_URL=http://127.0.0.1:18220
PLAYWRIGHT_API_BASE_URL=http://127.0.0.1:18221
LIVE_DB_DSN=host=127.0.0.1 port=18224 dbname=freelance_ops user=app_user
LIVE_FIXTURE_PYTHON=<locked Agent python executable>
LIVE_CONNECTION_SEED=<clone>/tests/live-workflow/seed-test-connection.py
LIVE_PDF_FONT=<clone>/frontend/node_modules/pretendard/dist/public/static/alternative/Pretendard-Regular.ttf
```

```text
npx playwright test -c playwright.live.config.mjs
```

Chrome uses a separate headless test profile on the test computer. Three browser
journeys select one, two and three opinions; the third uses a mobile viewport.
Two additional cases verify partial result preservation, stale confirmation,
idempotency and tenant isolation against actual services. They are counted
separately from `tests/browser/`, whose API fixtures are controlled UI tests.
The partial case also reloads the actual saved result in the browser and checks
that its incomplete-stage notice prevents a confirmation action.

The PDF test first requests the artifact and accepts the defined missing-font
503 only if the confirmed body remains unchanged. It then copies the repository
dependency's existing TTF into **build resources only** and verifies an actual
browser PDF download. It does not publish the font or prove remote CI PDF setup.

Sanitized method/path/status traffic and result IDs are under
`frontend/outputs/live-workflow/`. Headers, tokens and auth response bodies are
excluded; trace and video capture are disabled. Synthetic provider call counts
and the actual Spring component names are under `.tmp/live-workflow/`.
The browser cases also preserve the downloaded PDF and final material screenshot
in their result directories.
After the whole suite passes, retain actual persisted statuses and event types:

```text
python tests/live-workflow/capture-evidence.py frontend/outputs/live-workflow/results .tmp/live-workflow/database-evidence.json
```

Run this from the repository root with the same `LIVE_DB_DSN`. It reads only run
status, event IDs/types and confirmed specification revision/hash; it never reads
stored authentication/delegation request data.
These outputs are ignored by Git. Preserve evidence before rerunning, because
Playwright replaces its previous output directory. Stop only owned services and
the owned PostgreSQL instance afterward; keep data/evidence for inspection.
