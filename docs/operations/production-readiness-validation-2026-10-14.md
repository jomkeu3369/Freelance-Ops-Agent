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

The separate V52 pair rollback workflow uses a fresh isolated PostgreSQL17 database, synthetic fixtures and the exact prior public image digests. It uses no production identity or backup, and has no image-source or authentication fallback. Its result is laboratory compatibility evidence, not a release CI or deployment certificate. Candidate SHA and results must be pinned in the final evidence after that workflow finishes.
