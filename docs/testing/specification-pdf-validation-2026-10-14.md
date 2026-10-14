# Specification and Korean PDF validation - 2026-10-14

Local validation completed with 49 unique passing checks on PostgreSQL 18, followed
by 23 passing repetitions of the database/HTTP checks on PostgreSQL 17. Final failures
and skips are zero in both environments. Repetitions are not added to the unique
count. This is isolated work-branch evidence, not production validation or a full
remote CI pass. The existing remote font-publication blocker remains open.

## Checkout and preserved work

- Repository: `jomkeu3369/Freelance-Ops-Agent`.
- Baseline: `work/overnight-workflow-integration-20261014` at
  `1bf28eeaeb71ddabf422e1f08e171f4aff674027`, checked against the remote before cloning.
- Dedicated checkout: the new `task-4/spec-validation` directory.
- Dedicated branch: `work/spec-pdf-validation-resume-20261014`.
- Test commit: `ef6d47b5134768dacff982273130232aecde7b8a`.
- No applicable `AGENTS.md` was found in the repository or inspected ancestors.
- The previous `task-3/spec-validation` checkout was preserved, including its
  uncommitted provenance test and local-only font. Its assigned PDF ports had no
  existing listener before the new environment started.

The inherited test now compares the persisted provenance as JSON. PostgreSQL JSONB
can reload an integral value as a Java `Integer` when the original response used a
`Long`; the JSON value has not changed. The initial added test failed on this Java
representation difference. After correcting that assertion, all eight local
specification executions passed. Strings, numbers, nested source data and field
coverage remain compared, and the immutable-write rejection checks remain strict.

The committed regression also verifies unchanged source hashes and bodies through
user edits, rejected changes to draft/confirmed snapshots and original source
messages, exact final-body storage, and reuse of only final text with original
sources in the same project. No production Java, migrations or CI gates changed.

## Test environment and execution results

- Java 21.0.11 and Gradle 9.6.1.
- Initial environment: PostgreSQL 18.6 and pgvector 0.8.1 from the existing portable
  Ubuntu runtime through WSL. Its full evidence was preserved before switching.
- Final database regression: PostgreSQL 17.11 and pgvector 0.8.7 from the official
  portable Ubuntu PGDG packages made available by the server session. Both versions
  were verified with actual SQL against the dedicated DB. This matches the CI
  PostgreSQL major version; it does not exercise the Docker image or remote CI.
  The Docker Linux engine pipe remained unavailable, and no engine restart or
  shared resource cleanup was attempted.
- Initial own data directory: `/tmp/freelanceops-spec-pdf-20261014/data`.
- Final own data directory: `/tmp/freelanceops-spec-pdf-pg17-20261014/data`.
- Own DB: `127.0.0.1:18322/spec_validation`, using the permitted synthetic local
  fixture role. Other sessions' databases and tables were not modified.
- Actual Spring HTTP listener: `127.0.0.1:18321`.
- Local font: the unchanged licensed Pretendard npm 1.3.9 asset, SHA-256
  `6d0af5258997aec7354a6e340fc2325ba321c410ca48b3af858c8c3d6e92a324`.
  The TTF was excluded from Git staging and was not uploaded.

| Initial PostgreSQL 18 execution | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| `SpecificationPdfRendererTest` | 8 | 0 | 0 |
| `SpecificationServiceTest` | 12 | 0 | 0 |
| `SpecificationTextTest` | 6 | 0 | 0 |
| Local adapter of `ConnectedWorkflowPostgresTest` | 14 | 0 | 0 |
| Local adapter of `SpecificationPostgresTest`, plus real HTTP export | 8 | 0 | 0 |
| Separate actual HTTP missing-font preservation test | 1 | 0 | 0 |
| Total final evidence | 49 | 0 | 0 |

| PostgreSQL 17 database/HTTP repetition | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| Same 14 connected-workflow assertions | 14 | 0 | 0 |
| Same seven specification cases and real HTTP export | 8 | 0 | 0 |
| Actual HTTP missing-font preservation | 1 | 0 | 0 |
| Repeated database/HTTP checks, not additional unique checks | 23 | 0 | 0 |

The local adapters live in the ignored `runtime/` directory. They replace only
Docker provisioning with the explicit portable database. The specification adapter
also uses a defined-port server and genuine registration/login HTTP calls for its
synthetic identities. The original repository test assertions remain in these
adapters; no CI execution is reported under an altered class name. The required
14 connected-workflow assertions, committed Testcontainers configuration and report
gate were not skipped, reduced or changed. Those connected tests still use MockMvc
for their HTTP boundary; the additional specification export uses real Java
`HttpClient` sockets.

Commands executed from the dedicated checkout included:

```powershell
gradle -p backend test --tests 'com.freelanceops.backend.domain.specification.service.*' --no-daemon
python runtime/prepare-local-validation.py
gradle -p backend -I <absolute-runtime-path>/local-validation.gradle localSpecValidation --no-daemon --no-configuration-cache
gradle -p backend -I <absolute-runtime-path>/local-validation.gradle localSpecValidation --tests 'com.freelanceops.backend.integration.PortableSpecificationValidationTest' --no-daemon --no-configuration-cache
gradle -p backend -I <absolute-runtime-path>/local-validation.gradle -PspecFontAbsent missingFontValidation --no-daemon --no-configuration-cache
python runtime/prepare-local-validation.py --postgres-major 17
gradle -p backend -I <absolute-runtime-path>/local-validation.gradle -PspecDatabaseLabel='PostgreSQL 17.11' localSpecValidation --no-daemon --no-configuration-cache
gradle -p backend -I <absolute-runtime-path>/local-validation.gradle -PspecDatabaseLabel='PostgreSQL 17.11' -PspecFontAbsent missingFontValidation --no-daemon --no-configuration-cache
```

The negative-resource execution excluded only the generated build font copy. It
did not change the source font or rendering implementation, and the generated font
copy was restored after the run. Passing JUnit reports were preserved separately
from the initial failure and from negative-resource reports.

## Actual transport and PDF evidence

The dedicated HTTP test exercised actual registration and password login, bearer
authentication, specification creation/editing/confirmation/readback and PDF
download through the Spring security/controller/service/JPA stack and PostgreSQL.
It verified a draft export conflict (409), stale-hash confirmation conflict (409),
idempotent confirmation, wrong-project rejection (404), unauthenticated rejection
(401), exact provenance/readback, and final-text-only same-project search.

Repeated PDF GET responses were 200 with `application/pdf`, a UTF-8 attachment
filename, `private, no-store`, `nosniff`, the exact body-hash header and matching
content length. PDFBox verified all 28 synthetic requirements exactly once, the
last completion sentence, literal HTML-looking text, the explicit unsupported
emoji marker and normalized body-text equality. Poppler reported two A4 pages,
and both final page images were visually inspected for legible Korean and intact
content with no clipping or overlap.

- Final PostgreSQL 17 PDF size: 17,337 bytes; PDF version 1.6; two A4 pages.
- Confirmed body SHA-256:
  `d0310594f1c13186c5b60823715049fc4735730c9374b398c153f4ea1308747e`.
- Both repeated-download PDF SHA-256 values:
  `73dff1c98158ebf65e0e6307fdbb8b0e4c32db662ecde26fb50c1e3105bdeed7`.
- The separate resource-absence run verified actual PDF HTTP 503 with the same
  confirmed revision, body and complete response before/after the failed export.

The earlier PostgreSQL 18 PDF pair remains preserved with SHA-256
`9c6a25c2f5ceedae80401c49c6837d899851822182c77b8542d3a3c8ccf2de5a`.
Byte equality is required for repeated exports of the same immutable revision
within each run; the independent runs have different confirmation timestamps.

Local deliverables are in `task-4/output/pdf/`: the final PostgreSQL 17 and repeated PDFs,
two rendered PNG pages, confirmed body, extracted PDFBox text,
`http-pdf-evidence.json` and `missing-font-http-evidence.json`. The final JUnit
reports and `test-summary.json` are in `task-4/output/evidence/`. PostgreSQL 18
evidence is separately retained under `output/pdf/pg18/` and
`output/evidence/pg18/`; PostgreSQL 17 reports and SQL version evidence are under
`output/evidence/pg17/`. The combined summary explicitly excludes repeated checks
from its 49-check unique count.

`AgentRunGatewayService` supplies a synthetic completed analysis in specification
tests. The connected-workflow suite retains its existing outbound client doubles
and in-memory test signing fixture. `RaptorBuildClient` has no interactions. Actual
model/provider/embedding calls: zero. This does not validate real Agent analysis
transport, which belongs to the other session, or production account/data access.
No browser was used.

## Remaining boundaries

The TTF is still absent from the remote snapshot. Its earlier approval-pending
publication was not retried, and no alternate upload route or runtime font-download
fallback was introduced. The previously reported remote PDF/connected CI failures
must remain unresolved until the permitted resource is published and the required
CI PostgreSQL 17 suites execute successfully. These local results do not turn those
remote failures into passes.

Main merge, production deployment/migration, forced pushes, paid execution and
credential or permission expansion were not performed. Only this dedicated work
branch receives the approved ordinary push. Each session-owned PostgreSQL instance
is stopped normally after its validation, preserving its data and reports; shared
processes remain untouched.
