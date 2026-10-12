# Isolated real-backend load baseline (2026-10-12)

## Scope and predeclared gate

Baseline product commit: `ee59296ac1b5ab4e3b3e7fb35de084900c6eb7fc`.
Only test/benchmark files change. No product optimization is included.

This is a bounded exploratory baseline on one GitHub-hosted runner, **not a
production SLO or production user capacity estimate**. Real Spring Boot, Hibernate,
Flyway and PostgreSQL/pgvector serve every HTTP request. There is no mock backend.
The runtime containers share an `--internal` Docker network without outbound
routing; only loopback port 18080 is published. No Agent process, real-user data,
provider keys, production secrets or production URLs are used.

Before measurement, the following gate is written to `gate.json`:

- Each normal route: p95 <500 ms, p99 <1,000 ms, failure fraction <1%.
- Semantic failures=0; dropped scheduled requests=0; achieved RPS >=95% of target;
  per-route p99 dispatch lag <100 ms. Arrivals overdue by 100 ms are dropped, not
  silently replayed after the measurement window.
- All normal business requests must be HTTP 200 with the expected fixture shape.
  429, other 4xx, 5xx, transport failures and HTTP-200 contract failures are separate.
- A single expected unauthenticated 401 is a separate control and never contributes
  to normal business throughput.
- Do not escalate a scenario after a failed gate. Repeat its last attempted rate
  once to confirm the observation, unless a safety stop prevents further work.
- Stop at >5% failures in the most recent 20–50 completed requests, container
  memory >=90% of its 2-GiB limit, or CPU >=98% of its 2-core quota for five samples.
  A process timeout or Docker OOM also prevents successful completion.

Short samples, particularly n<100, are flagged. A short observed pass does not
establish a reliable long-run p99. Percentiles use nearest-rank observed latency.

## Reproduce

Requirements: Linux, Docker, Java 21, Python 3, curl; official dependency/image
registries must be reachable during build. No Python/npm load dependencies needed.
Use a disposable machine with ports/container names below unused.

```sh
python3 -m unittest discover -s infra/load -p 'test_isolated*.py' -v
bash infra/load/run-isolated-backend.sh
```

The script refuses preexisting `foa-load-backend`, `foa-load-postgres` or
`foa-load-internal` resources, builds the real bootJar, pulls official runtime
images, initializes a new database, runs Flyway and the actual server, executes the
campaign, saves evidence and removes only its own containers/network on exit.
Container images are resolved by digest and recorded for exact later comparisons.
No named volume persists the database. Output is in `output/isolated-load/` and is
ignored by git. The workflow uploads it for seven days; selected sanitized results
should be committed alongside a dated report for durable evidence.

The dedicated workflow is push-triggered only on
`work/isolated-backend-load-20261012` for its harness paths, or manually dispatched.
It has read-only repository permission, does not use repository secrets, does not
open a PR, merge, publish an image or deploy. Timeout is 25 minutes.

## Data and workload

The actual register/client/project APIs create one synthetic active owner, one
workspace, one client and 30 projects. The register age field describes a
fictional adult test account. Three projects hold 10/100/1000 independent DRAFT
quotations. `isolated_seed.sql` verifies the isolated database name, synthetic
workspace prefix and actual ownership, requires an empty target project, then
inserts and asserts the real FK/check/unique-constrained rows in one transaction.

Each quotation has 6 items, 3 assumptions, 3 evidence rows: total 1,110 quotations,
6,660 items, 3,330 assumptions, 3,330 evidence rows. It uses deterministic
project-scoped IDs, varied scenario/unit rates, fixed timestamps, synthetic text,
consistent totals and no external source URLs. Dataset sizes coexist in the DB.
Quote list returns all quotes and full nested item/basis data; there is no API
pagination in this baseline. `ANALYZE` runs before warmup.

For each size, first validate each endpoint, then warm up for 10 seconds at 5 RPS:

- Equal-weight business mix: `/me` (workspace membership), project list, project
  search, project detail, quotation list, quotation detail. 5→20→50 RPS.
- Quotation list alone: 1→5→10 RPS.
- Each stage lasts 20 seconds; the last attempted rate is repeated once on the
  same running JVM/database. Rates advance only when the observed gate passes.
- At most 32 in-flight HTTP/1.1 keep-alive requests, a 5-second timeout and no
  hidden executor backlog. Scheduled requests beyond the cap are dropped and
  counted. Target-rate scheduling is open-loop; dispatch lag is measured.
- RPS uses wall time including the final response drain. Setup, warmup, SQL probes
  and the negative control are excluded from business results.

Two serial `pg_stat_statements` probes per size measure the exact quotation table
family statement count, expected `1+3N`, and retain normalized statement signatures.
All-app statement totals may contain background scheduler queries and are labelled
separately. Resource observations do not query quotation tables. A separate EXPLAIN
option is available in the SQL fixture; it is diagnostic, not API performance.

## Environment and evidence

- API and DB: each limited to 2 CPUs / 2 GiB, co-located on the runner.
- JVM: Java 21, G1, `-Xms512m -Xmx1024m -XX:ActiveProcessorCount=2`.
- Hikari pool=10, production-default GET rate limiter behavior unchanged.
- API metrics endpoint remains denied by application security. PostgreSQL
  app-user active/idle/waiting sessions are a pool-usage proxy, not Hikari wait-time
  instrumentation. Container CPU/memory and JVM GC logs are captured.
- `environment.txt`: CPU/OS/memory, source SHA, Java/PostgreSQL versions, image
  digests, runtime limits and internal-network flag.
- `requests.csv`: per-request route/status/latency/dispatch lag/validity/bytes only.
- `summary.json`, `report.md`: per-route count, RPS, p50/p95/p99 and errors, stages,
  gates, query probes and stop reasons.
- `resources.json`: three-second container and DB-session observations.
- `backend.log`, readiness and final-state JSON: startup/GC/shutdown diagnostics.
- Access/refresh tokens and passwords remain in process memory; request/response
  bodies and environment dumps are not saved. Disposable DB bootstrap passwords
  in the script are not real credentials and cannot reach any external service.

Limitations: single synthetic tenant, short warm read-only tests, fixed data shape,
shared hosted runner and co-located generator; no write scaling, auth hashing
capacity, network geography, AI, SSE, OCR, multi-tenant fairness or soak coverage.
