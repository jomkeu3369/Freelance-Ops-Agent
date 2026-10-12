#!/usr/bin/env python3
"""Bounded, open-loop real-backend read benchmark; no third-party Python modules.

This script only talks to 127.0.0.1:18080 and named disposable Docker resources.
Tokens, request bodies and response bodies are never written to benchmark files.
"""
from __future__ import annotations

import concurrent.futures
import csv
import http.client
import json
import math
import os
from pathlib import Path
import re
import secrets
import statistics
import subprocess
import threading
import time

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(os.environ.get("LOAD_OUTPUT_DIR", ROOT / "output/isolated-load"))
PG = "foa-load-postgres"
API = "foa-load-backend"
MAX_CONCURRENCY = 32
DURATION = 20
WARMUP = 10
TIMEOUT = 5
GATE = {"p95_ms_lt": 500, "p99_ms_lt": 1000, "error_fraction_lt": 0.01,
        "dropped_eq": 0, "semantic_failures_eq": 0, "achieved_target_fraction_gte": 0.95,
        "p99_schedule_lag_ms_lt": 100,
        "note": "Exploratory local gate, not a production SLO; n<100 has weak tail evidence."}
TLS = threading.local()


def pg(sql, variables=None, source=None):
    cmd = ["docker", "exec", "-i", PG, "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1",
           "-U", "load_admin", "-d", "isolated_load"]
    for key, value in (variables or {}).items():
        cmd += ["-v", f"{key}={value}"]
    result = subprocess.run(cmd, input=source if source is not None else sql, text=True,
                            capture_output=True, check=True, timeout=60)
    return result.stdout.strip()


def percentile(values, q):
    """Nearest-rank empirical percentile; disclose sample count alongside it."""
    if not values:
        return None
    ordered = sorted(values)
    return ordered[max(0, math.ceil(q * len(ordered)) - 1)]


def send(method, path, token=None, body=None):
    if not path.startswith(("/api/v2/", "/actuator/health/")) or "://" in path:
        raise ValueError("Only fixed local API paths are permitted")
    # No URL parameter or external-origin override is intentionally supported.
    connection = getattr(TLS, "connection", None)
    if connection is not None and time.monotonic() - getattr(TLS, "last_used", 0) >= 5:
        # Do not reuse long-idle setup/probe sockets across workload stages.
        # This is proactive recycling, never a retry of a measured request.
        connection.close()
        connection = TLS.connection = None
    if connection is None:
        connection = TLS.connection = http.client.HTTPConnection("127.0.0.1", 18080, timeout=TIMEOUT)
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    start = time.perf_counter()
    try:
        connection.request(method, path, json.dumps(body) if body is not None else None, headers)
        response = connection.getresponse()
        data = response.read(64 * 1024 * 1024 + 1)
        elapsed = (time.perf_counter() - start) * 1000
        if len(data) > 64 * 1024 * 1024:
            raise ValueError("Response exceeds safety cap")
        try:
            parsed = json.loads(data)
        except (ValueError, UnicodeDecodeError):
            parsed = None
        TLS.last_used = time.monotonic()
        return response.status, parsed, elapsed, len(data)
    except (OSError, http.client.HTTPException, ValueError):
        connection.close()
        TLS.connection = None
        return 0, None, (time.perf_counter() - start) * 1000, 0


def create(path, body, token=None):
    status, result, _, _ = send("POST", path, token, body)
    if status != 201 or not isinstance(result, dict):
        raise RuntimeError(f"Synthetic setup failed: {path.rsplit('/', 1)[-1]} HTTP {status}")
    return result


def fixtures():
    user = create("/api/v2/auth/register", {
        "email": f"isolated-load-{secrets.token_hex(6)}@example.invalid",
        "password": secrets.token_urlsafe(24), "displayName": "Synthetic load adult",
        "workspaceName": "Isolated load synthetic workspace", "ageAtLeast14": True})
    prefix = f"/api/v2/workspaces/{user['workspaceId']}"
    client = create(prefix + "/clients", {"name": "Synthetic client", "companyName": "Load fixture"}, user["accessToken"])
    projects = []
    for index in range(30):
        projects.append(create(prefix + "/projects", {
            "clientId": client["id"], "title": f"{'SearchOnly' if index == 0 else 'Synthetic'} load project {index}",
            "requirementText": "Synthetic fixture. No model calls. " * 20,
            "currency": "KRW"}, user["accessToken"]))
    dataset = {}
    for count, project in zip((10, 100, 1000), projects):
        pg(None, {"isolated_test": "true", "workspace_id": user["workspaceId"],
                  "user_id": user["userId"], "project_id": project["id"], "quotation_count": count},
           (ROOT / "infra/load/isolated_seed.sql").read_text())
        quote_id = pg(f"SELECT id FROM app.quotation WHERE project_id='{project['id']}' ORDER BY created_at DESC LIMIT 1")
        dataset[count] = {"project": project, "quotation_id": quote_id}
    pg("ANALYZE app.quotation; ANALYZE app.quotation_item; ANALYZE app.quotation_assumption; ANALYZE app.quotation_evidence; ANALYZE app.project;")
    return user, prefix, projects, dataset


def quote_valid(body, user, project_id):
    return (isinstance(body, dict) and body.get("workspaceId") == user["workspaceId"]
            and body.get("projectId") == project_id and len(body.get("items", [])) == 6
            and all(isinstance(item.get("basis"), dict) for item in body["items"]))


def routes(user, prefix, projects, dataset, count):
    project = dataset[count]["project"]
    quote_id = dataset[count]["quotation_id"]
    return [
        ("workspace_me", "/api/v2/me", lambda b: isinstance(b, dict) and b.get("id") == user["userId"] and len(b.get("workspaces", [])) == 1),
        ("projects_list", prefix + "/projects", lambda b: isinstance(b, list) and len(b) == 30 and all(p.get("workspaceId") == user["workspaceId"] for p in b)),
        ("projects_search", prefix + "/projects?search=SearchOnly", lambda b: isinstance(b, list) and len(b) == 1 and b[0].get("id") == projects[0]["id"]),
        ("project_detail", prefix + f"/projects/{project['id']}", lambda b: isinstance(b, dict) and b.get("id") == project["id"] and b.get("workspaceId") == user["workspaceId"]),
        ("quotations_list", prefix + f"/projects/{project['id']}/quotations", lambda b: isinstance(b, list) and len(b) == count and all(quote_valid(q, user, project["id"]) for q in b)),
        ("quotation_detail", prefix + f"/quotations/{quote_id}", lambda b: quote_valid(b, user, project["id"]) and b.get("id") == quote_id),
    ]


def request(route, token, scheduled):
    name, path, validator = route
    started = time.perf_counter()
    status, body, latency, size = send("GET", path, token)
    try:
        valid = status == 200 and bool(validator(body))
    except (KeyError, TypeError, AttributeError, ValueError):
        valid = False
    return {"route": name, "status": status, "latency_ms": round(latency, 3),
            "schedule_lag_ms": round(max(0, started - scheduled) * 1000, 3),
            "valid": valid, "bytes": size}


class Resources:
    def __init__(self):
        self.stop = threading.Event()
        self.samples = []
        self.abort = None
        self.stage = "setup"
        self.thread = threading.Thread(target=self.run, daemon=True)

    def run(self):
        hot = 0
        while not self.stop.is_set():
            try:
                started = time.monotonic()
                data = subprocess.check_output(
                    ["docker", "stats", "--no-stream", "--format", "{{json .}}", API, PG], text=True, timeout=8)
                rows = [json.loads(line) for line in data.splitlines()]
                for row in rows:
                    row["elapsed_s"] = round(time.monotonic() - self.start, 3)
                    row["stage"] = self.stage
                    self.samples.append(row)
                    if float(row["MemPerc"].rstrip("%")) >= 90:
                        self.abort = "container memory >=90% of 2 GiB limit"
                # CPU saturation is recorded, not mistaken for a crash. Stop after
                # sustained >98% of quota AND elevated latency at the stage gate.
                hot = hot + 1 if any(float(r["CPUPerc"].rstrip("%")) >= 196 for r in rows) else 0
                if hot >= 5:
                    self.abort = "container CPU >=98% of 2-core quota for five resource samples"
                db = pg("SELECT json_build_object('connections',count(*),'active',count(*) FILTER (WHERE state='active'),'idle',count(*) FILTER (WHERE state='idle'),'waiting',count(*) FILTER (WHERE wait_event_type='Lock')) FROM pg_stat_activity WHERE usename='app_user'")
                self.samples.append({"stage": self.stage, "elapsed_s": round(time.monotonic()-self.start, 3), "db_sessions": json.loads(db)})
                self.stop.wait(max(0, 3-(time.monotonic()-started)))
            except (subprocess.SubprocessError, ValueError, KeyError) as exc:
                self.samples.append({"stage": self.stage, "observation_error": type(exc).__name__})
                self.stop.wait(3)

    def begin(self):
        self.start = time.monotonic()
        self.thread.start()

    def finish(self):
        self.stop.set()
        self.thread.join(timeout=10)
        (OUT / "resources.json").write_text(json.dumps(self.samples, indent=2))


def aggregate(rows, seconds, dropped, target):
    groups = {}
    for row in rows:
        groups.setdefault(row["route"], []).append(row)
    result = {"target_rps": target, "duration_s": round(seconds, 3), "requests": len(rows),
              "achieved_rps": round(len(rows) / seconds, 3), "dropped": dropped, "routes": {}}
    for name, records in groups.items():
        times = [r["latency_ms"] for r in records]
        statuses = {}
        for row in records:
            statuses[str(row["status"])] = statuses.get(str(row["status"]), 0) + 1
        failed = sum(not r["valid"] for r in records)
        metrics = {"n": len(records), "rps": round(len(records)/seconds, 3),
                   "p50_ms": percentile(times, .5), "p95_ms": percentile(times, .95),
                   "p99_ms": percentile(times, .99), "max_ms": max(times),
                   "status_counts": statuses, "errors": failed,
                   "http_429": statuses.get("429", 0),
                   "unexpected_4xx": sum(v for k, v in statuses.items() if 400 <= int(k) < 500 and k != "429"),
                   "server_5xx": sum(v for k, v in statuses.items() if int(k) >= 500),
                   "transport_errors": statuses.get("0", 0),
                   "semantic_failures": sum(r["status"] == 200 and not r["valid"] for r in records),
                   "mean_response_bytes": round(statistics.mean(r["bytes"] for r in records)),
                   "p99_schedule_lag_ms": percentile([r["schedule_lag_ms"] for r in records], .99),
                   "tail_sample_warning": len(records) < 100}
        metrics["observed_gate_pass"] = (metrics["p95_ms"] < 500 and metrics["p99_ms"] < 1000
                                         and failed / len(records) < .01 and metrics["semantic_failures"] == 0
                                         and metrics["p99_schedule_lag_ms"] < 100)
        result["routes"][name] = metrics
    result["target_attainment_fraction"] = round(len(rows) / seconds / target, 4)
    result["observed_gate_pass"] = bool(rows) and dropped == 0 and len(rows) / seconds >= target * .95 and all(r["observed_gate_pass"] for r in result["routes"].values())
    return result


def stage(name, selected, token, rate, resources, duration=DURATION, preserve=True):
    resources.stage = name
    results, pending = [], set()
    drops = 0
    started = time.perf_counter()
    deadline = started + duration
    next_request = started
    index = 0
    abort = None
    cpu_start = time.process_time()
    with concurrent.futures.ThreadPoolExecutor(max_workers=MAX_CONCURRENCY) as pool:
        while next_request < deadline:
            now = time.perf_counter()
            if next_request > now:
                time.sleep(next_request-now)
            completed = {f for f in pending if f.done()}
            results.extend(f.result() for f in completed)
            pending -= completed
            if resources.abort:
                abort = resources.abort
                break
            recent = results[-50:]
            if len(recent) >= 20 and sum(not r["valid"] for r in recent) / len(recent) > .05:
                abort = "last 20-50 requests exceed 5% failure"
                resources.abort = abort
                break
            if time.perf_counter() >= deadline:
                drops += math.ceil((deadline-next_request)*rate)
                break
            if len(pending) >= MAX_CONCURRENCY or time.perf_counter()-next_request >= .1:
                drops += 1
            else:
                pending.add(pool.submit(request, selected[index % len(selected)], token, next_request))
            index += 1
            next_request = started + index / rate
        results.extend(f.result() for f in concurrent.futures.as_completed(pending))
        if not abort:
            time.sleep(max(0, deadline-time.perf_counter()))
    elapsed = time.perf_counter()-started
    # Include final response drain in achieved throughput; scheduled-rate window
    # remains separately reported. There is no hidden, unbounded executor queue.
    summary = aggregate(results, elapsed, drops, rate)
    summary.update({"name": name, "scheduled_window_s": duration,
                    "offered": index, "max_concurrency": MAX_CONCURRENCY,
                    "generator_cpu_s": round(time.process_time()-cpu_start, 3), "abort": abort})
    if abort:
        summary["observed_gate_pass"] = False
    if preserve:
        with (OUT / "requests.csv").open("a", newline="") as file:
            writer = csv.writer(file)
            for row in results:
                writer.writerow([name] + [row[k] for k in ("route", "status", "latency_ms", "schedule_lag_ms", "valid", "bytes")])
        print(json.dumps({"stage": name, "requests": len(results), "rps": summary["achieved_rps"],
                          "gate": summary["observed_gate_pass"], "abort": abort}), flush=True)
    return summary


def query_probe(route, token, count):
    # Two sequential samples per cardinality, never concurrent with a load stage.
    probes = []
    for repeat in (1, 2):
        pg("SELECT pg_stat_statements_reset();")
        result = request(route, token, time.perf_counter())
        if not result["valid"]:
            raise RuntimeError(f"Query probe failed for N={count}: HTTP {result['status']}")
        statements = json.loads(pg("""SELECT COALESCE(json_agg(json_build_object('query',query,'calls',calls,'rows',rows,'exec_ms',total_exec_time)), '[]'::json)
          FROM pg_stat_statements WHERE query ~* 'app\\.' AND query !~* 'pg_stat_statements'"""))
        quote_calls = sum(s["calls"] for s in statements if re.search(r'\bapp\.quotation(?:\b|_)', s["query"]))
        probes.append({"quotation_count": count, "repeat": repeat, "request": result,
                       "quotation_family_select_calls": quote_calls,
                       "expected_quotation_family_select_calls": 1 + 3*count,
                       "expected_count_matches": quote_calls == 1 + 3*count,
                       "all_app_statement_calls": sum(s["calls"] for s in statements),
                       "statements": statements})
    return probes


def write_report(summary):
    lines = ["# Isolated real-backend load baseline", "", f"Baseline: `{summary['baseline']}`", "",
             "Real Spring Boot + disposable PostgreSQL/pgvector; authenticated synthetic data; no Agent/provider process.",
             "Runtime containers have an internal-only Docker network. This is not production capacity or a production SLO.", "",
             "Gate declared before execution: per-route p95 <500 ms, p99 <1,000 ms; failure <1%; semantic failures=0; dropped=0; achieved RPS >=95% target; p99 dispatch lag <100 ms.",
             "20-second stages; 10-second warm-up; maximum 32 outstanding requests; 5-second timeout. Highest attempted rate repeated once.",
             "Nearest-rank percentiles. Rows with n<100 have weak p99 evidence. No auth rejection is counted as successful business throughput.", "",
             "| Dataset | Stage | Route | n | RPS | p50 ms | p95 ms | p99 ms | Errors | 429 | Dropped | Gate |", "|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|"]
    for item in summary["stages"]:
        for name, row in item["routes"].items():
            lines.append(f"| {item['quotation_count']} | {item['name']} | {name} | {row['n']} | {row['rps']} | {row['p50_ms']} | {row['p95_ms']} | {row['p99_ms']} | {row['errors']} | {row['http_429']} | {item['dropped']} | {'pass' if row['observed_gate_pass'] and item['observed_gate_pass'] else 'fail'} |")
    lines += ["", "## Database statement probes", "", "| Quotations | Repeat | Quotation-family SELECTs | Expected 1+3N | All app statements* |", "|---:|---:|---:|---:|---:|"]
    for probe in summary["query_probes"]:
        lines.append(f"| {probe['quotation_count']} | {probe['repeat']} | {probe['quotation_family_select_calls']} | {probe['expected_quotation_family_select_calls']} | {probe['all_app_statement_calls']} |")
    lines += ["", "*All app statements may contain periodic scheduler noise; exact quotation-family SELECT count is separate.",
              "", "Resources: resources.json contains container CPU/memory plus PostgreSQL app-user active/idle/waiting sessions. These sessions approximate pool usage; Hikari wait-time instrumentation is unavailable because /actuator/metrics is denied by the unchanged app. GC events are in backend.log.",
              "", f"Safety stop: {summary.get('abort') or 'none'}. Fatal harness error: {summary.get('error') or 'none'}.",
              "", "Limitations: shared hosted runner, co-located generator/DB/API, 2-core and 2-GiB limits per container, 1-GiB JVM heap, pool=10; short tests, warm read-heavy workload, single tenant; no writes, production network, AI, SSE, OCR or sustained soak. Dataset sizes coexist (1,110 quotations total), and run order is small to large. Compare repetitions on this same runner; do not generalize to production concurrency."]
    (OUT / "report.md").write_text("\n".join(lines)+"\n")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    summary = {"baseline": "ee59296ac1b5ab4e3b3e7fb35de084900c6eb7fc", "gate": GATE,
               "dataset": {"users": 1, "workspaces": 1, "clients": 1, "projects": 30,
                           "quotations_per_target_project": [10, 100, 1000], "items_per_quotation": 6,
                           "assumptions_per_quotation": 3, "evidence_per_quotation": 3},
               "stages": [], "query_probes": [], "abort": None}
    (OUT / "gate.json").write_text(json.dumps(summary, indent=2))
    (OUT / "requests.csv").write_text("stage,route,status,latency_ms,schedule_lag_ms,valid,bytes\n")
    resources = Resources()
    resources.begin()
    try:
        user, prefix, projects, dataset = fixtures()
        token = user["accessToken"]
        # Auth-negative behavior is an explicit, separate one-request control.
        status, _, _, _ = send("GET", prefix + "/projects")
        summary["negative_control"] = {"requests": 1, "expected_status": 401, "actual_status": status}
        if status != 401:
            raise RuntimeError("Unauthenticated control did not return 401")
        for count in (10, 100, 1000):
            selected = routes(user, prefix, projects, dataset, count)
            for route in selected:
                result = request(route, token, time.perf_counter())
                if not result["valid"]:
                    raise RuntimeError(f"Smoke failed: N={count} route={route[0]} status={result['status']}")
            stage(f"n{count}_warmup", selected, token, 5, resources, WARMUP, preserve=False)
            if resources.abort:
                summary["abort"] = resources.abort
                break
            summary["query_probes"].extend(query_probe(selected[4], token, count))
            for mode, operations, rates in (("mixed", selected, (5, 20, 50)),
                                             ("quotations", [selected[4]], (1, 5, 10))):
                last_rate = None
                for rate in rates:
                    result = stage(f"n{count}_{mode}_{rate}rps", operations, token, rate, resources)
                    result["quotation_count"] = count
                    summary["stages"].append(result)
                    last_rate = rate
                    if result["abort"] or not result["observed_gate_pass"]:
                        break
                if resources.abort:
                    summary["abort"] = resources.abort
                    break
                # Confirm both successes and failures; never escalate after failure.
                result = stage(f"n{count}_{mode}_{last_rate}rps_repeat", operations, token, last_rate, resources)
                result["quotation_count"] = count
                summary["stages"].append(result)
                if resources.abort:
                    summary["abort"] = resources.abort
                    break
            if resources.abort:
                break
    except Exception as error:
        # Exception text may contain local command details; store type and a
        # controlled message only. Never dump token-bearing setup responses.
        summary["error"] = type(error).__name__ + (": " + str(error) if isinstance(error, RuntimeError) else "")
        raise
    finally:
        resources.finish()
        (OUT / "summary.json").write_text(json.dumps(summary, indent=2)+"\n")
        write_report(summary)


if __name__ == "__main__":
    main()
