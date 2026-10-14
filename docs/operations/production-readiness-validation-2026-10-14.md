# Production metadata and server-local recovery point — 2026-10-14

This procedure prepares evidence for a release; it does not authorize or perform deployment. The full candidate still requires an exact final SHA, unchanged CI gates and resolution of the existing font upload approval.

## Current production observation

[GitHub run 38500110867](https://github.com/jomkeu3369/Freelance-Ops-Agent/actions/runs/38500110867) completed successfully from validation commit `2d4f5e23dee73934946f738c9a08a7d54c740469`. It used the existing production SSH identity and host trust, the existing production environment, and the shared deployment concurrency lock.

At `2026-10-14T02:16:00Z`:

| Component | Running immutable tag | Result |
| --- | --- | --- |
| Backend | `backend-775b92c8dbaafbdd21438140d4238e39e1aa8ef1` | Healthy, marker matches, restart count 0, no OOM |
| Agent | `agent-9a48b5d18672f02fdcb30269b1dffc3f0a414d24` | Healthy, marker matches, restart count 0, no OOM |
| PostgreSQL | 17.11, Flyway V48, Alembic `20260912_0007` | Failed migrations 0, waiting locks 0 |
| Backend readiness | Loopback and public endpoint | `UP` |

Exact observed image IDs and repository digests:

- Backend: `sha256:eaa06af3b6fc1b04430ef872fa1f290102faa4dc362a18dc6583381b8531e6d0`
- Agent: `sha256:d3429b0c281c0292489715225bb2ef0c95b6de4c168aeca9c67a85d1f8f56f69`

App/runtime active runs, pending commands, unfinished tasks/attempts and pending scheduler entries were all zero. App WAITING was zero. Runtime WAITING and orphan WAITING were each one; the procedure preserved this existing work. This is an observation at one instant, not proof of a continuous admission pause.

The host had one CPU, 43.14% sampled CPU use, load 0.33545, 810.2 MiB/41.38% available memory and 15.18 GiB/32.78% free disk. The database size was 17,192,627 bytes. These measurements describe the observation, not a load test.

A separate anonymous HEAD of the public frontend at `2026-10-14T02:39:08Z` returned HTTP200, HTML and a Vercel serving header. It does not prove the exact current frontend runtime SHA. No browser or logged-in user session was used.

## Fresh server-local archive

The same run retained a new custom-format `pg_dump` under the existing backup root:

- Path: `/var/backups/freelance-ops/readiness_20261014T021600Z_2d4f5e23dee7/freelance_ops.dump`
- Size: 574,470 bytes
- SHA256: `0c49b0b4b6a877eedfbf98b3c50233353aebf8ab626c646ab1e677ce53dfbfdd`
- New snapshot directory `0700`; archive and catalog `0600`
- Catalog decoding, full archive decoding to `/dev/null`, and repeated SHA256 check all succeeded.

No archive was transferred off-host and no database restore was performed. Decoding an archive is not a restore drill. Production configuration, key values, prompts, identifiers and table contents were not returned in the metadata. The procedure does not read `.env` or Docker `.Config.Env`; Docker inspection selects only image/state fields. Subprocess failures expose only bounded error codes.

## Authorization and procedure differences

The existing production verification workflow is push-only, with pinned Backend/Agent SHAs, schema and verification mode. The existing preflight workflow is also push-only and takes its validation commit SHA; it previously expected schema47 and an older image pair. Both use the same existing GitHub SSH secrets and production environment. Their historical scripts inspect configuration/key values, which is outside this task's allowed read scope.

The dedicated `work/production-validation-20261014` branch therefore contains a metadata-only/local-archive procedure using that same existing identity. It never invokes Compose, deployment scripts, migrations, role changes, restores or remote backup destinations. Ten safety tests passed locally and in the GitHub job before server access. Changed image/schema, active work, low resource headroom or unsafe snapshot paths stop archive creation; waiting/orphan data is preserved and reported.

The separate V52 pair rollback workflow uses a fresh isolated PostgreSQL17 database, synthetic fixtures and the exact prior public image digests. It uses no production identity or backup, and has no image-source or authentication fallback. Its result is laboratory compatibility evidence, not a release CI or deployment certificate.

Image identity uses the exact registry `RepoDigest` and Linux/amd64 platform. Docker's graphdriver and containerd stores can expose different local `.Id` representations for the same manifest, so equal local IDs across those engines are not the identity criterion. This distinction is documented in the [Moby containerd image inspector](https://github.com/moby/moby/blob/master/daemon/containerd/image_inspect.go). Four regression tests require the exact manifest even if a local ID matches, reject a wrong platform and accept a differing config ID only with the exact manifest.

## Completed V52 paired rollback rehearsal

[GitHub run 38502746550](https://github.com/jomkeu3369/Freelance-Ops-Agent/actions/runs/38502746550), validation code `824ff19a39d9e852c73dd1444a249aeaa579d9d2`, passed against laboratory candidate `116692fc81b0116e6c8209eb51ce89a9a151c48b`. The journey owner subsequently kept that candidate on hold for separate execution-authority/concurrency regressions. This test does not lift that hold, and a final candidate must be coordinated with that owner.

| Validation group | Final result | Failed | Skipped |
| --- | --- | --- | --- |
| Secret-free production snapshot safety | 10 tests passed locally and in the production verification job | 0 | 0 |
| Exact registry identity regression | 4 tests passed locally and in the successful laboratory job | 0 | 0 |
| Real PG17/image-pair rehearsal | 14 named checks passed | 0 | 0 |

The final job had no skipped build, verification or post-job steps. Earlier laboratory attempts stopped on harness-local image-ID comparison and host-routing issues; those were corrected and reverified with exact manifest identity and container-local HTTP. No production code, production images, shared environment or existing test gates were altered to fix the harness.

The rehearsal used PostgreSQL17.11 and pgvector0.8.7 on an internal Docker network. Both prior production images were pulled anonymously by their exact recorded digests, with no source/image/authentication fallback. HTTP requests used the services' own container loopback; the separate network kept external model routing unavailable. Fixture signing used the existing connected-test RSA-2048 in-memory pattern and fixture database roles/passwords. Actual user registration/login and wrong-password rejection ran through Spring; no user-login bypass was used.

The sequence was:

1. Start exact old Backend775/Agent9a on new synthetic PG17; apply V1–V48 and read a saved completed fixture result.
2. Stop that pair while leaving the same database alive. Start the pinned candidate Spring/Agent; apply V49→V52 and preserve the legacy saved result and usage.
3. Confirm analysis and specification through actual HTTP; retain its final-only keyword document. With the remote font absent, PDF returns HTTP503 while the confirmed artifact remains intact. This observation does **not** replace the 14 mandatory connected/PDF CI cases or treat them as passing.
4. Validate PARTIAL in the V52 app constraint and actual Spring/Agent projection; seed a synthetic conservative monthly liability while `completion_required` and spending remain disabled.
5. Stop the candidate pair and run the exact old image pair on the unchanged V52 database. Verify normal login, project/quotation/document and saved COMPLETED/PARTIAL reads, scope rejection, and zero paid replay.
6. Use the old project-update HTTP API. Verify the V51 source invalidation trigger remains compatible while preserving immutable specification/provenance and monetary rows.
7. Re-forward to the candidate pair. Verify schema/data remain unchanged and the historical specification correctly reports its changed source as obsolete.

All 52 successful Flyway entries and Alembic `20260912_0007` were retained. Complete schema hashes were identical before rollback, after old startup/reads/project write and after re-forward:

`83b551442e94248bdf31565371770f925ce17e4e09af72ca06139ac934f8343f`

The complete selected artifact/runtime/money snapshot matched byte-for-byte as structured data across old startup and reads. Re-forward matched the legitimate old-write snapshot. The fixture contained one confirmed specification, two saved runtime runs and one monthly liability entry. Provider-attempt counts and actual model calls were zero. Only this harness's disposable containers/network were cleaned up.

The synthetic-only evidence ZIP has SHA256 `8b7994fc1aaccbd33cce3439e2f2090eb9c83c644244cfb7cbe8107d86387122`. It contains schema/history/data comparisons and readiness records; the production archive was never used or copied into the lab.

## Remaining release prerequisites

- Final integrated candidate and unchanged CI, including the existing font approval and all mandatory PDF/connected cases, remain outside this compatibility result.
- The verified rollback scope keeps completion/spend disabled. Old Agent mixed with new Spring does not enforce the new worker deadline; new Agent rejects old deadline-free START/RESUME. A reviewed admission pause/drain and paired deployment/recovery procedure is still required before switching production.
- The existing orphan WAITING entry is preserved. A fresh inventory must distinguish that history from new in-flight work at a later release boundary; do not delete, replay, cancel or reissue authority merely to produce empty counts.
- The local archive was catalogued/fully decoded/checksummed. Off-host transfer/configuration, actual database restore, production migrations, cancellation/admission pause, main merge and image switching were not performed in this task.
