"""Independent bounded-page correctness and UX measurements, after legacy A/B.

Same disposable DB and no-egress runtime. Never persists tokens or response bodies.
The legacy load phases return the same full data; page phases return at most 50
quotations and must not be presented as equal-workload latency improvements.
"""
import json
import re
import secrets
import time
import urllib.parse
import uuid

import isolated_backend_load as L


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def expected_ids(workspace_id, project_id):
    return json.loads(L.pg("SELECT COALESCE(json_agg(id ORDER BY created_at DESC,id DESC),'[]'::json) "
                         f"FROM app.quotation WHERE workspace_id='{workspace_id}' AND project_id='{project_id}'"))


def list_path(prefix, project_id):
    return prefix + f"/projects/{project_id}/quotations"


def page_route(user, prefix, project_id, ids, limit=50):
    def valid(body):
        return (isinstance(body, dict) and isinstance(body.get("items"), list)
                and [q.get("id") for q in body["items"]] == ids[:limit]
                and all(L.quote_valid(q, user, project_id) for q in body["items"])
                and "nextCursor" in body
                and ((isinstance(body["nextCursor"], str) and bool(body["nextCursor"]))
                     if len(ids) > limit else body["nextCursor"] is None))
    return ("quotations_page50", list_path(prefix, project_id) + f"/page?limit={limit}", valid)


def collect_pages(user, prefix, project_id, count, limit):
    path = list_path(prefix, project_id)
    ids = expected_ids(user["workspaceId"], project_id)
    require(len(ids) == count, "Page fixture cardinality changed unexpectedly")
    status, full, _, _ = L.send("GET", path, user["accessToken"])
    require(status == 200 and isinstance(full, list), "Legacy response unavailable for page parity")
    require([q.get("id") for q in full] == ids, "Legacy stable order differs from database order")
    collected, cursors = [], set()
    cursor = None
    total_ms = total_bytes = requests = 0
    while True:
        page = path + f"/page?limit={limit}"
        if cursor:
            page += "&cursor=" + urllib.parse.quote(cursor, safe="")
        status, body, elapsed, size = L.send("GET", page, user["accessToken"])
        require(status == 200 and isinstance(body, dict), "Page traversal failed")
        items = body.get("items")
        require(isinstance(items, list) and len(items) <= limit, "Page limit not respected")
        require(all(L.quote_valid(q, user, project_id) for q in items), "Page item contract mismatch")
        offset = len(collected)
        require([q.get("id") for q in items] == ids[offset:offset + limit], "Page omission, duplicate, or sort mismatch")
        collected.extend(items)
        total_ms += elapsed
        total_bytes += size
        requests += 1
        cursor = body.get("nextCursor")
        if cursor is None:
            break
        require(isinstance(cursor, str) and bool(cursor) and cursor not in cursors, "Page cursor failed to advance")
        cursors.add(cursor)
        require(len(items) == limit and requests <= count + 1, "Invalid continuation page")
    require(collected == full, "All-page DTOs differ from the legacy full response")
    return {"quotation_count": count, "limit": limit, "http_requests": requests,
            "collected": len(collected), "unique": len({q["id"] for q in collected}),
            "exact_legacy_dto_parity": True, "sum_http_latency_ms": round(total_ms, 3),
            "sum_response_bytes": total_bytes,
            "note": "Serial functional traversal, not a load-test percentile; full data across multiple HTTP responses."}


def page_probe(route, token, count, limit=50):
    probes = []
    for repeat in (1, 2):
        L.pg("SELECT pg_stat_statements_reset();")
        result = L.request(route, token, time.perf_counter())
        require(result["valid"], "Bounded page SQL probe response failed")
        statements = json.loads(L.pg("""SELECT COALESCE(json_agg(json_build_object('query',query,'calls',calls,'rows',rows,'exec_ms',total_exec_time)), '[]'::json)
          FROM pg_stat_statements WHERE query ~* 'app\\.' AND query !~* 'pg_stat_statements'"""))
        quotation = [s for s in statements if re.search(r'\bapp\.quotation(?:\b|_)', s["query"])]
        calls, rows = sum(s["calls"] for s in quotation), sum(s["rows"] for s in quotation)
        expected_rows = min(count, limit + 1) + 12 * min(count, limit)
        require(calls == 4, "Bounded page did not use four quotation-family queries")
        require(rows == expected_rows, "Bounded page query row count differs from bounded independent associations")
        probes.append({"quotation_count": count, "repeat": repeat, "limit": limit,
                       "request": result, "quotation_family_select_calls": calls,
                       "quotation_family_rows": rows, "expected_rows": expected_rows,
                       "statements": statements})
    return probes


def keyset_plans(user, dataset):
    project = dataset[1000]["project"]["id"]
    boundary = json.loads(L.pg("SELECT row_to_json(boundary) FROM (SELECT id,created_at FROM app.quotation "
        f"WHERE project_id='{project}' ORDER BY created_at DESC,id DESC OFFSET 899 LIMIT 1) boundary"))
    prefix = ("EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT q.* FROM app.quotation q "
              f"WHERE q.workspace_id='{user['workspaceId']}' AND q.project_id='{project}' AND ")
    timestamp, quotation = boundary["created_at"], boundary["id"]
    predicates = {
        "current_or_boundary": f"(q.created_at<'{timestamp}'::timestamptz OR (q.created_at='{timestamp}'::timestamptz AND q.id<'{quotation}'::uuid))",
        "equivalent_tuple_boundary": f"(q.created_at,q.id)<('{timestamp}'::timestamptz,'{quotation}'::uuid)",
    }
    return {name: json.loads(L.pg(prefix + predicate + " ORDER BY q.created_at DESC,q.id DESC LIMIT 51"))
            for name, predicate in predicates.items()}


def controls(user, prefix, projects, dataset):
    token = user["accessToken"]
    project = dataset[1000]["project"]["id"]
    path = list_path(prefix, project)
    results = []
    for suffix in ("?limit=0", "?limit=101", "?limit=-1", "?limit=x", "?cursor=bad-cursor"):
        status, _, _, _ = L.send("GET", path + "/page" + suffix, token)
        require(status == 400, "Malformed pagination input was not rejected with HTTP 400")
        results.append({"control": "invalid-pagination" + suffix, "status": status})
    for count in (10, 100, 1000):
        target = dataset[count]["project"]["id"]
        results.append(collect_pages(user, prefix, target, count, 50))
    results.append(collect_pages(user, prefix, projects[-1]["id"], 0, 100))
    results.append(collect_pages(user, prefix, dataset[10]["project"]["id"], 10, 1))
    results.append(collect_pages(user, prefix, project, 1000, 100))
    status, default, _, _ = L.send("GET", path + "/page", token)
    require(status == 200 and len(default.get("items", [])) == 50, "Default page size is not 50")
    # Mutate synthetic timestamps only after ALL measured legacy and page stages.
    # Equal timestamps force the UUID tiebreaker over many page boundaries.
    L.pg(f"UPDATE app.quotation SET created_at=TIMESTAMPTZ '2026-01-01 00:00:00+00' WHERE project_id='{project}'")
    tie = collect_pages(user, prefix, project, 1000, 73)
    tie["control"] = "all-created-at-tied-database-uuid-order"
    results.append(tie)
    other = L.create("/api/v2/auth/register", {
        "email": f"isolated-control-{secrets.token_hex(6)}@example.invalid",
        "password": secrets.token_urlsafe(24), "displayName": "Synthetic control adult",
        "workspaceName": "Isolated load control workspace", "ageAtLeast14": True})
    for name, target, auth, expected in (
        ("missing-auth", path + "/page", None, 401),
        ("other-workspace-member", path + "/page", other["accessToken"], 404),
        ("project-outside-workspace", list_path(f"/api/v2/workspaces/{other['workspaceId']}", project) + "/page", other["accessToken"], 404),
        ("project-not-found", list_path(prefix, str(uuid.uuid4())) + "/page", token, 404),
    ):
        status, _, _, _ = L.send("GET", target, auth)
        require(status == expected, "Pagination authorization or project-scope control failed: " + name)
        results.append({"control": name, "status": status, "expected_status": expected})
    L.pg(f"DELETE FROM app.role_permission WHERE workspace_id='{user['workspaceId']}' AND permission_code='quotation.read'")
    status, _, _, _ = L.send("GET", path + "/page", token)
    require(status == 403, "Member without quotation.read was not rejected with HTTP 403")
    results.append({"control": "member-permission-revoked", "status": status, "expected_status": 403})
    return results


def run_page_campaign(user, prefix, projects, dataset, resources, summary):
    summary.update({"scope": "New page UX: at most 50 full quotations per response; NOT equal work to legacy full list.",
               "query_probes": [], "stages": [], "controls": [], "abort": None})
    for count in (10, 100, 1000):
        project_id = dataset[count]["project"]["id"]
        ids = expected_ids(user["workspaceId"], project_id)
        route = page_route(user, prefix, project_id, ids)
        summary["query_probes"].extend(page_probe(route, user["accessToken"], count))
    selected = L.routes(user, prefix, projects, dataset, 1000)
    selected[4] = route
    L.stage("n1000_page_warmup", selected, user["accessToken"], 5, resources, L.WARMUP, preserve=False)
    if resources.abort:
        summary["abort"] = resources.abort
        return summary
    for mode, operations, rates in (("page_mixed", selected, (5, 20, 50)), ("page_only", [route], (1, 5, 10))):
        for rate in rates:
            result = L.stage(f"n1000_{mode}_{rate}rps", operations, user["accessToken"], rate, resources)
            result["quotation_count"] = 1000
            summary["stages"].append(result)
            if result["abort"] or not result["observed_gate_pass"]:
                break
        if resources.abort:
            summary["abort"] = resources.abort
            return summary
        result = L.stage(f"n1000_{mode}_{rate}rps_repeat", operations, user["accessToken"], rate, resources)
        result["quotation_count"] = 1000
        summary["stages"].append(result)
        if resources.abort:
            summary["abort"] = resources.abort
            return summary
    resources.stage = "post_measurement_page_correctness_controls"
    summary["keyset_plans"] = keyset_plans(user, dataset)
    summary["controls"] = controls(user, prefix, projects, dataset)
    return summary
