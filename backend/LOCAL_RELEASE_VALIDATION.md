# Isolated V35–V39 release verification

Base revision: `6bfe089af8f5f25c5c15d7e9f7b6a68962112f28`.
Local branch: `codex/local-backend-db-validation-20261004`.
Date: 2026-10-04 UTC.

## Results

- Production Java compilation, boot JAR packaging, and all test-source compilation: passed.
- Docker-independent regression suite: **296 tests, 0 failures, 0 errors, 0 skipped**, across 83 XML suites.
- The eight PostgreSQL test classes were explicitly excluded from that run. Zero skipped does not imply DB coverage.
- V35–V39 migration and PostgreSQL integration execution: **not executed**, blocked by the local Docker engine.
- Docker image build, production deployment/migration, and real provider/mail calls: not executed.

The first test launch failed before test execution with `GradleWorkerMain` ClassNotFoundException.
The existing worker JAR and class were present. Repeating the same build with temporary ASCII drive
aliases for the workspace and Gradle cache resolved the launch failure. Existing caches were not deleted.

## Added acceptance test

`FullReleaseMigrationPostgresTest` uses a disposable `pgvector/pgvector:pg17` database and synthetic
account/workspace/project fixtures. It upgrades V35 to V37, inserts one synthetic existing platform
capability, then applies V38–V39. It verifies:

- exactly four forward migrations and current version V39;
- preserved legacy account, workspace, project input and revision;
- existing account verification remains optional and is not falsely backfilled;
- all eleven new feature tables and the default usage settings;
- unchanged empty usage ledgers and notice/campaign stores;
- preservation of the pre-V39 grant and support for the new composite capability primary key;
- Flyway validation and a zero-migration second run.

This class uses `@Testcontainers` without `disabledWithoutDocker=true`: an unavailable Docker
engine cannot silently turn this acceptance test green. It compiled successfully but its database
assertions have **not yet been executed**.

## Execution limits and isolation

The local runner uses JDK 21, one Gradle worker, one test fork, 512 MB heaps, and two active processors.
It removes inherited provider keys, production datasource settings, delegation keys, and SMTP
credentials from its child process. Gradle generates the project's existing ephemeral test JWT key.
Existing notice tests use an in-memory mail transport; contract tests use a loopback mock agent.
The runner does not start the application with production configuration or copy any operational data.

## Docker blocker and next acceptance step

Installed Docker Desktop 4.34.2 was launched, but showed `Error - Docker Desktop`; neither local
engine pipe responded. Windows denied opening `com.docker.service` for a start attempt. The legacy
diagnostic client warned about LxssManager, while the installed WSL service is WslService and is
running. That warning alone does not establish the root cause. No service-start configuration,
WSL distribution, security setting, container, or volume was reset/deleted.

First resolve the Desktop error and prove a local **Linux** engine is ready. Then run the new
acceptance class and all seven existing PostgreSQL classes without exclusions, followed by the
full regression suite. Require zero failed/error/skipped DB cases and record the exact source
commit plus test XML. Test a V35 application rollback against migrated V39 schema separately;
switching an image does not undo these forward migrations.

The current evidence is **insufficient to approve production release**.
