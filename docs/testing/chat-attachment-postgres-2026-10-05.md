# Chat attachment PostgreSQL integration coverage

`ChatAttachmentPostgresTest` uses the existing disposable `pgvector/pgvector:pg17`
Testcontainers/Spring Boot pattern and the complete Flyway migration chain, including
V45. Only the external `AttachmentReaderClient` is mocked. Membership, permissions,
project locking, token issuance, JSONB, the monetary ledger, run/outbox creation,
idempotency and transaction rollback use their real implementations. Signing keys
are generated in memory for the test. Dispatch and reconciliation are disabled;
no parser service, model provider or production database is contacted.

## Coverage

- A preview persists only extraction metadata/text and its owner/workspace/project
  scope, with a 30-minute expiry. Neither original synthetic bytes nor their base64
  representation appears in staging or the committed START command. Reading a
  preview leaves it staged and does not create a run or spend reservation
- V45 rejects a mismatched workspace/project foreign key and oversized JSONB;
  deleting a project cascades only its staging rows
- Parser failure and upload transaction rollback leave no staging row
- Expiry cleanup removes expired rows across owners while preserving fresh rows;
  expired receipts cannot be resolved or started
- The 12-item staging quota spans one account's projects and workspaces. Upload
  cleanup reclaims only that owner's expired rows. A concurrent upload on a second
  project is observed waiting on PostgreSQL's account-row lock before being rejected
  as item 13; a barrier keeps the first extraction in flight until the wait is seen
- Resolution, deletion and consumption enforce all four receipt dimensions; missing
  membership, foreign projects, revoked membership/permissions and deleting projects
  cannot upload, delete or start existing receipts
- START alone consumes selected staging rows after writing its durable command;
  idempotent replay works after staging is gone, without duplicating the command or
  reservation. Both caller rollback and a real database outbox-insert failure restore
  staging and roll back the run, idempotency record and reservation, allowing retry
- Duplicate receipts, a seventh receipt, more than 8 MiB total and more than 40,000
  Unicode code points fail without consumption. Exactly six, 8 MiB and 40,000 code
  points are accepted. Large boundary fixtures insert synthetic validated extraction
  records directly; parser/file-format validation remains covered separately

## Verification boundary

Authored in the dot cloud checkout. The focused Gradle invocation completed on
2026-10-05: Java/test compilation succeeded; all 19 tests were skipped, with zero
failures or errors. Docker is unavailable here and no Docker process was started. This class uses `disabledWithoutDocker = true`; an execution that skips
it is **not** evidence that PostgreSQL migration/locking/rollback assertions passed.
Run in a supported Docker-capable cloud CI runner with Java 21:

```sh
cd backend
./gradlew test --tests com.freelanceops.backend.integration.ChatAttachmentPostgresTest
```

Require zero skipped tests in this class before marking its database behavior
verified. Compilation/test execution status is reported with the integration result;
this note does not claim that unexecuted assertions passed. HTTP multipart handling,
filesystem spill behavior and the live Spring-to-Python reader boundary are outside
this database-focused suite.
