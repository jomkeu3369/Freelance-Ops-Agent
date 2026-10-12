# Quotation optimization verification protocol

The dedicated `verify-quotation-load.yml` workflow runs on a work branch only.
No deployment, providers, production traffic/data, repository secrets, or persistent
credentials are used. Runtime networks have no egress; no ports are published.

Three fresh disposable runtimes run sequentially on the same hosted runner:

1. Baseline `ee59296`: unchanged full-list workload, N = 10 / 100 / 1000.
2. Pinned optimized SHA: **identical full-list workload and response cardinality**.
3. Same optimized SHA: bounded page workload, 50 full DTOs out of history of 1000.

The third result is page-oriented UX performance, not an equal-workload speedup.
A safety stop in either legacy campaign never raises its rate further. The separate
page campaign restarts with a fresh DB/JVM, retaining the same resource constraints;
it does not bypass or reset safety observations inside a running campaign.

The original fixture, workload, warm-up, stage duration, open-loop generator,
latency/attainment gates and resource safety stops remain unchanged. API/DB each
have 2 CPUs and 2 GiB; Java 21/G1 has 1 GiB heap, pool=10. Images are fixed to the
exact digests recorded in the original baseline run. Product and harness SHAs,
fixture SHA-256 and runtime digests are preserved in the evidence.

Legacy quotation-family expectations are 1 + 3N before and 1 + 3ceil(N/100)
after; combined rows remain 13N for this fixture (N parents, 6N items, 3N assumptions,
3N evidence). No join multiplies the collections. A nonempty 50-item page uses
4 statements and min(N,51) + 12min(N,50) rows including the lookahead parent.
SQL probes run serially outside measured load and all-app statement noise is
kept separate. They do not measure total business authorization query count.

After page measurements, HTTP controls check exact DTO equality against legacy
when traversing all pages, UUID/database ordering for 1000 equal timestamps,
limits 1/50/100, empty history, default50, malformed inputs, unauthenticated and
cross-workspace access, and a project not found. Timestamp mutation and a second
synthetic control account occur only after all performance samples.

The raw files are preserved as GitHub workflow artifacts, not committed or uploaded
to public repository contents. A private report/CSV can be delivered separately.
Workflow success means execution/evidence retention, not all performance gates pass.
Report per-route and whole-stage gate separately, weak tails when n<100, unattempted
stages, abort reasons, full-response bytes versus page bytes, and normal request
counts excluding setup/warmup/probes/negative controls.

Limits: one sequential A/B pair, shared hosted runner, read-only warm workload,
co-located generator/API/DB, fixed synthetic shapes and single measured tenant.
This is not a production SLO, capacity estimate, long-run p99 or soak test.

## Final tuple boundary follow-up

After the original paired run, the continuation predicate is changed to a native
PostgreSQL row-value boundary. The follow-up workflow pins the final product SHA
and repeats the same first-page load campaign on a fresh runtime, then adds a
19th-page workload after 900 rows, actual emitted-SQL probes, and all correctness
controls. The original full-list A/B stays attributed to its original product SHA.
This follow-up does not rerun unchanged legacy paths or claim a second paired A/B.
