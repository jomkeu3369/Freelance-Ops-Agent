# Chat, reviewed policy changes, and MCP PostgreSQL verification

The two new test classes contain **12 test methods**. They were added on PC091 against
`689eb545b163f85bebfce7b791fe94435015bf31`. Their code was reviewed against the current DTOs,
repositories, controllers, schema migrations, and outbox dispatcher. **Compilation and execution
have not yet been verified:** this PC currently has Java 8, no detected Docker installation/CLI,
and WSL enumeration fails with access denied. No Java/Docker installation, WSL permission change,
production DB access, or deployment was performed.

## Coverage

`PolicyProposalMigrationPostgresTest` upgrades a disposable pgvector PostgreSQL 17 database from
V35 with synthetic existing users, workspaces, and projects to V36. It checks preservation of
project data/revision, migration validation/idempotence, proposal indexes, tenant composite foreign
keys, idempotency uniqueness, approval state invariants, valid rates/nonblank source messages,
and project-scoped cascade deletion. It never invokes Flyway clean.

`ChatPolicyMcpPostgresTest` boots the full Spring context and real security chain with a different
disposable PostgreSQL container. It checks:

- Fresh migration through V36 and the vector extension.
- Authenticated HTTP proposal creation/confirmation, committed persistence, and no policy change
  before approval; repeated confirmation preserves the applied version/time.
- Creation idempotency, conflicting key reuse, invalid confirmation tokens, expiry, and stale revisions.
- Concurrent confirmation of the same proposal applies once; competing proposals based on the same
  revision produce one successful approval and one conflict.
- Creator, project, tenant, and write-permission isolation.
- Real JWT validation and RBAC-filtered MCP discovery; actual project queries and tenant rejection;
  rejected write tools and unexpected tenant arguments; unchanged project/policy business data.
- A chat HTTP request persisted as a run and START outbox command, explicitly dispatched through
  the real dispatcher to a loopback mock HTTP agent. The agent validates ephemeral signed delegation
  tokens and matching run/workspace/project context. MCP progress/result and stored chat history
  then resolve that same run and original input. No model/provider call occurs.

Repositories, authorization services, JWT validation, and the agent HTTP client are not mocked.
Background command dispatch and reconciliation remain disabled. The one outbox dispatch is an
explicit test call. Each test has unique synthetic users/workspaces; no preexisting DB is targeted.
Signing keys are generated in memory and the mock server binds only to `127.0.0.1` on an ephemeral
port, closing after the class. The container owns the datasource URL and synthetic credentials.

MCP progress/result currently invoke the gateway's existing projection synchronization. Accordingly
the execution test verifies the agent run's projected status changes; it does not assert that these
queries issue zero SQL writes. Project summaries and policy data remain unchanged. Eliminating
projection writes would be a separate application behavior change.

## Required execution before acceptance

Use Java 21 and a confirmed working Docker engine, after PC091 environment setup is authorized.
From `backend` on Windows:

```powershell
./gradlew.bat test --no-daemon --tests '*ChatPolicyMcpPostgresTest' --tests '*PolicyProposalMigrationPostgresTest'
./gradlew.bat test --no-daemon
```

The targeted run must report **12 executed, 0 failed, 0 skipped**. Existing conventions use
`@Testcontainers(disabledWithoutDocker = true)`, so a green result with skipped cases does not count
as DB verification. Inspect `backend/build/test-results/test` and `backend/build/reports/tests/test`.
The full suite must also execute the existing 21 PostgreSQL cases rather than skip them.

Additional Python agent/PostgreSQL restart and full browser/backend integration coverage remains
separate. These tests do not connect to external MCP hosts or exercise real model output, billing,
production data, or deployment.
