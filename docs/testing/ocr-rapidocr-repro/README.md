# Frozen candidate feasibility reproducer

Historical probes and gate/plan files are copied unchanged from the 2026-10-07 run. No originals, model binaries, credentials or private policy are stored in Git. Read the [decision report](../ocr-rapidocr-feasibility-2026-10-07.md) before running. These commands are documentation; the operator must have authorization for the chosen machine, files and time.

`Dockerfile` here is a replay variant using the **recorded hash lock** rather than resolving floating transitive dependencies again. The original run's full image ID is recorded in the report. Rebuilding apt/base layers later can differ from the historical image; keep the image inspect/build metadata when comparing.

The original image build and probes were executed. This hash-lock replay variant and model-fetch utility were reviewed statically and were not run as a new evaluation after the failed resource gate.

1. Use an isolated checkout of source `aa1fa8bc1707d7c8763d7ac8dd153f6eb79cfc34` or report commit `2e487d253db1a4efd7fe6bdd3fefd40d8b5d9e2f` to build the unchanged Agent Dockerfile as `codex-ocr-coverage-candidate-20261007`. Override its normal DB migration entrypoint during evaluation; the probe image below does so.
2. Run `python fetch_models.py` in this directory to fetch official public assets with mandatory SHA256 verification. This writes only `models/` here. The separate standalone utility uses Python standard libraries; no host package installation is required. Preserve the existing input Library's supported materialization flow: this utility is only for the public candidate models.
3. Copy `feasibility-plan.json` plus the three already-materialized synthetic PNG files it names into a separate `probe-inputs` directory. Verify their SHA256 against the plan. This is a resource screening plan using the old three phrases, **not** a new independent quality dataset.
4. Build `docker buildx build --resource memory=1g --resource cpu-period=100000 --resource cpu-quota=100000 --load -t codex-ocr-rapidocr-feasibility-20261007 .`. Only listed public models/probes/lock enter the build context.
5. Create a new empty output directory, then run one container as shown below. The driver has the historical UTC-hour cutoff (before 07:00 / 16:00 KST); explicitly adapt it to an authorized later session if reproducing on a different date. Do not start another evaluation concurrently. A normal container exit can still contain `gates_passed=false`; inspect the CSV and decision JSON.

```powershell
docker run --rm --cpus 1 --memory 640m --pids-limit 256 --read-only --tmpfs /tmp:size=256m,noexec,nosuid --security-opt no-new-privileges:true --network none --mount "type=bind,source=<absolute-probe-inputs>,target=/probe-inputs,readonly" --mount "type=bind,source=<absolute-empty-output>,target=/results" codex-ocr-rapidocr-feasibility-20261007
```

The driver starts each worker in its own process group, reads `/proc` at 20ms intervals, uses the unchanged Agent native runner, records cold import/model initialization, enforces AS512MiB/CPU12s/FSIZE0/native3s/shared8s/outer15s and stops expansion after a failed input's three repeats. The parent monitor and cgroup values measure different scopes; summed RSS can double count shared pages and is not container memory usage. No full candidate API integration or quality comparison was attempted after the observed resource gate failure.
