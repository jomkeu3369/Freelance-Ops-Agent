#!/usr/bin/env python3
"""Synthetic-only V48 rollback check. Python stdlib and existing Docker/Java tools only."""
import base64
import hashlib
import hmac
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

CANDIDATE = "910a86f9c8f45577a7dc37a2dfd96b26502970eb"
OLD = "9a48b5d18672f02fdcb30269b1dffc3f0a414d24"
# Confirmed deployed RepoDigest in preflight run 38208389819; pull is anonymous.
OLD_IMAGE = "ghcr.io/jomkeu3369/freelance-ops-backend@sha256:13bc8e4c0dc331c25593b61f3ae7fbdd3cfea6b991e1df9329acbabe6e52e947"
JRE = "eclipse-temurin:21-jre"
POSTGRES = "pgvector/pgvector:pg17"
EVIDENCE = Path("rollback-evidence")
USER = "10000000-0000-0000-0000-000000000001"
WORKSPACE = "20000000-0000-0000-0000-000000000001"
PREFIX = "quotation-rollback-" + os.environ.get("GITHUB_RUN_ID", str(os.getpid()))
NETWORK = PREFIX + "-internal"
DATABASE = PREFIX + "-db"
CONTAINERS = []
REPORT = {"candidate_sha": CANDIDATE, "old_sha": OLD, "cases": [], "result": "incomplete"}


def write_json(name, value):
    EVIDENCE.mkdir(exist_ok=True)
    (EVIDENCE / name).write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")


def run(args, *, input=None, env=None, check=True):
    result = subprocess.run(args, input=input, env=env, text=True, capture_output=True)
    if check and result.returncode:
        # Never include environment values or generated bearer tokens in an exception.
        raise RuntimeError(f"{args[0]} {args[1]} failed: {result.stderr[-4000:]}")
    return result


def resolve_image():
    EVIDENCE.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="rollback-anonymous-docker-") as directory:
        result = run(["docker", "--config", directory, "pull", OLD_IMAGE], check=False)
    selection = {
        "mode": "image" if result.returncode == 0 else "source",
        "requested_old_image": OLD_IMAGE,
        "source_commit": OLD,
        "anonymous_pull_succeeded": result.returncode == 0,
        "production_digest_evidence": "https://github.com/jomkeu3369/Freelance-Ops-Agent/actions/runs/38208389819",
    }
    if result.returncode:
        # Anonymous registry diagnostics contain no private credentials.
        selection["anonymous_pull_error"] = result.stderr[-2000:]
    else:
        selection["local_repo_digests"] = json.loads(run([
            "docker", "image", "inspect", "--format", "{{json .RepoDigests}}", OLD_IMAGE
        ]).stdout)
        require(OLD_IMAGE in selection["local_repo_digests"], "Pulled image must match verified digest")
    write_json("old-runtime-selection.json", selection)
    with open(os.environ["GITHUB_OUTPUT"], "a") as output:
        output.write(f"mode={selection['mode']}\n")
    print(f"Old runtime selection: {selection['mode']}; exact old source: {OLD}", flush=True)


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def case(name, **facts):
    REPORT["cases"].append({"name": name, "passed": True, **facts})
    write_json("summary.json", REPORT)
    print(f"PASS: {name}", flush=True)


def sql(statement):
    return run(["docker", "exec", "-i", DATABASE, "psql", "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1",
                "-U", "postgres", "-d", "rollback_synthetic"], input=statement).stdout.strip()


def token(secret):
    def encode(value):
        return base64.urlsafe_b64encode(json.dumps(value, separators=(",", ":")).encode()).rstrip(b"=")
    now = int(time.time())
    body = b".".join([encode({"alg": "HS256", "typ": "JWT"}), encode({
        "sub": USER, "iss": "freelance-ops-backend", "aud": "freelance-ops-web",
        "token_type": "access", "iat": now, "exp": now + 1800,
    })])
    signature = base64.urlsafe_b64encode(hmac.new(secret.encode(), body, hashlib.sha256).digest()).rstrip(b"=")
    return (body + b"." + signature).decode()


def request(path, bearer=None):
    headers = {} if bearer is None else {"Authorization": "Bearer " + bearer}
    request = urllib.request.Request("http://127.0.0.1:18080" + path, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as error:
        body = error.read()
        return error.code, json.loads(body) if body else None


def wait_ready(name):
    deadline = time.monotonic() + 180
    last = "not listening"
    while time.monotonic() < deadline:
        try:
            status, body = request("/actuator/health/readiness")
            last = f"HTTP {status}, body {body}"
            if status == 200 and body.get("status") == "UP":
                write_json(name + "-readiness.json", {"http_status": status, "body": body})
                return
        except (OSError, ValueError):
            pass
        running = run(["docker", "inspect", "--format", "{{.State.Running}}", name]).stdout.strip()
        require(running == "true", f"Backend exited before readiness: {name}")
        time.sleep(2)
    raise AssertionError(f"Readiness did not reach HTTP 200 UP: {last}")


def start_backend(label, env, *, image=None, jar=None):
    name = PREFIX + "-" + label
    args = ["docker", "run", "-d", "--name", name, "--network", NETWORK,
            "--publish", "127.0.0.1:18080:8080", "--cap-drop", "ALL", "--security-opt", "no-new-privileges"]
    for key in env:
        args += ["-e", key]
    if jar:
        args += ["--mount", f"type=bind,src={jar.resolve()},dst=/app/app.jar,readonly", JRE,
                 "java", "-jar", "/app/app.jar"]
    else:
        args += [image]
    CONTAINERS.append(name)
    run(args, env={**os.environ, **env})
    wait_ready(name)
    return name


def snapshot(label):
    history = json.loads(sql("SELECT json_agg(row_to_json(h) ORDER BY installed_rank) FROM app.flyway_schema_history h;"))
    applied = [row for row in history if row["version"] is not None]
    require(len(applied) == 48 and all(row["success"] for row in applied), "Exactly 48 successful migrations required")
    require({int(row["version"]) for row in applied} == set(range(1, 49)), "Migration versions must be exactly V1-V48")
    indexes = json.loads(sql("""SELECT json_agg(row_to_json(i) ORDER BY indexname) FROM (
        SELECT p.indexname, p.indexdef, x.indisvalid, x.indisready
        FROM pg_indexes p JOIN pg_class c ON c.relname = p.indexname
        JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = p.schemaname
        JOIN pg_index x ON x.indexrelid = c.oid WHERE p.schemaname = 'app' AND p.tablename = 'quotation'
    ) i;"""))
    keyset = [row for row in indexes if row["indexname"] == "ix_quotation_project_created_id"]
    require(len(keyset) == 1 and keyset[0]["indisvalid"] and keyset[0]["indisready"], "V48 keyset index must remain valid and ready")
    require("(workspace_id, project_id, created_at DESC, id DESC)" in keyset[0]["indexdef"], "V48 keyset index definition must match")
    schema = run(["docker", "exec", DATABASE, "pg_dump", "--schema-only", "--schema=app", "--no-owner", "--no-privileges",
                  "-U", "postgres", "-d", "rollback_synthetic"]).stdout
    # PostgreSQL 17 emits a newly generated psql restriction nonce on each dump.
    schema = "\n".join(line for line in schema.splitlines() if not line.startswith(("\\restrict ", "\\unrestrict ")))
    data = {}
    for table in ("quotation", "quotation_item", "quotation_assumption", "quotation_evidence"):
        data[table] = json.loads(sql(f"SELECT json_agg(row_to_json(r) ORDER BY id) FROM app.{table} r;"))
    zero_tables = ("agent_run", "agent_run_usage", "agent_run_command", "platform_spend_reservation")
    for table in zero_tables:
        require(sql(f"SELECT count(*) FROM app.{table};") == "0", f"No agent/cost activity permitted: {table}")
    result = {"history": history, "quotation_indexes": indexes,
              "schema_sha256": hashlib.sha256(schema.encode()).hexdigest(), "quotation_data": data}
    write_json(label + "-snapshot.json", result)
    (EVIDENCE / (label + "-schema.sql")).write_text(schema + "\n")
    return result


def verify_arrays(label, bearer):
    payloads = {}
    for project, count in ((1, 0), (2, 1), (3, 101)):
        project_id = f"50000000-0000-0000-0000-{project:012d}"
        path = f"/api/v2/workspaces/{WORKSPACE}/projects/{project_id}/quotations"
        status, rows = request(path, bearer)
        require(status == 200 and isinstance(rows, list) and len(rows) == count,
                f"{label} legacy array read must return HTTP 200 and exactly {count} quotations")
        require(len({row['id'] for row in rows}) == count, "No duplicate quotation IDs")
        for row in rows:
            require(row["workspaceId"] == WORKSPACE and row["projectId"] == project_id, "Quotation scope must match")
            require(row["total"] == 200 and row["status"] == "DRAFT" and row["currency"] == "KRW", "Quotation scalars must match")
            require([item["title"] for item in row["items"]] == ["Assumption item", "Evidence item"], "Ordered child items must match")
            require(row["items"][0]["basis"]["content"] == "assumption:" + row["id"], "Assumption relation must match")
            require(row["items"][1]["basis"]["content"] == "evidence:" + row["id"], "Evidence relation must match")
        # Old implementation does not promise ID ordering for tied creation times.
        payloads[project_id] = sorted(rows, key=lambda row: row["id"])
        case(label + f" legacy array count={count}", http_status=status, quotation_count=count)
    status, _ = request(path)
    require(status == 401, "Unauthenticated quotation read must stay unauthorized")
    case(label + " unauthenticated quotation read", http_status=status)
    write_json(label + "-legacy-arrays.json", payloads)
    return payloads


def boot_jar(directory):
    jars = list(Path(directory, "backend/build/libs").glob("*.jar"))
    jars = [jar for jar in jars if not jar.name.endswith("-plain.jar")]
    require(len(jars) == 1, f"Expected one exact-source bootJar in {directory}")
    return jars[0]


def verify():
    EVIDENCE.mkdir(exist_ok=True)
    for directory, sha in (("candidate-source", CANDIDATE), ("old-source", OLD)):
        require(run(["git", "-C", directory, "rev-parse", "HEAD"]).stdout.strip() == sha, "Pinned source identity required")
        require(not run(["git", "-C", directory, "diff", "--name-only"]).stdout.strip(), "Product source must remain untouched")
    selection = json.loads((EVIDENCE / "old-runtime-selection.json").read_text())
    REPORT["old_runtime"] = selection
    run(["docker", "pull", POSTGRES])
    run(["docker", "pull", JRE])
    REPORT["runtime_images"] = {image: json.loads(run(["docker", "image", "inspect", "--format", "{{json .RepoDigests}}", image]).stdout)
                                for image in (POSTGRES, JRE)}
    run(["docker", "network", "create", "--internal", NETWORK])
    require(run(["docker", "network", "inspect", "--format", "{{.Internal}}", NETWORK]).stdout.strip() == "true", "Runtime network must block external routing")
    password = secrets.token_hex(24)
    jwt_secret = secrets.token_hex(32)
    env = {
        "DB_URL": f"jdbc:postgresql://{DATABASE}:5432/rollback_synthetic", "DB_USERNAME": "app_user", "DB_PASSWORD": password,
        "APP_ENVIRONMENT": "test", "APP_AUTH_JWT_SECRET": jwt_secret, "AGENT_BASE_URL": "http://127.0.0.1:9",
        "AGENT_COMMAND_DISPATCH_ENABLED": "false", "AGENT_RECONCILIATION_ENABLED": "false",
        "AGENT_ROUTE_OBSERVATION_COLLECTION_ENABLED": "false", "PLATFORM_AI_SPEND_ENABLED": "false",
        "APP_NOTICES_DISPATCH_ENABLED": "false", "APP_RATE_LIMIT_ENABLED": "false",
    }
    REPORT["safety"] = {"synthetic_only": True, "internal_network": True, "platform_spend_enabled": False,
                        "agent_dispatch_enabled": False, "agent_reconciliation_enabled": False,
                        "provider_credentials_supplied": False, "flyway_and_hibernate_validation_unchanged": True}
    try:
        CONTAINERS.append(DATABASE)
        run(["docker", "run", "-d", "--name", DATABASE, "--network", NETWORK,
             "-e", "POSTGRES_PASSWORD", "-e", "POSTGRES_DB=rollback_synthetic", POSTGRES],
            env={**os.environ, "POSTGRES_PASSWORD": password})
        for _ in range(60):
            if run(["docker", "exec", DATABASE, "pg_isready", "-U", "postgres", "-d", "rollback_synthetic"], check=False).returncode == 0:
                break
            time.sleep(1)
        require(sql("SELECT current_setting('server_version_num')::int / 10000;") == "17", "PostgreSQL major must be 17")
        sql(f"CREATE EXTENSION vector; CREATE EXTENSION btree_gist; CREATE ROLE app_user LOGIN PASSWORD '{password}'; "
            "CREATE SCHEMA app AUTHORIZATION app_user; REVOKE CREATE ON SCHEMA public FROM PUBLIC;")
        candidate = start_backend("candidate", env, jar=boot_jar("candidate-source"))
        case("Candidate actual runtime readiness", http_status=200, status="UP")
        sql(Path(".github/scripts/rollback/synthetic-fixture.sql").read_text())
        bearer = token(jwt_secret)
        candidate_arrays = verify_arrays("candidate", bearer)
        before = snapshot("before-old-startup")
        case("Candidate migrated actual database through V48", migration_count=48, index_valid=True)
        run(["docker", "stop", "--time", "30", candidate])
        # Keep PostgreSQL running continuously. No down, clean, repair, or schema mutation.
        if selection["mode"] == "image":
            old = start_backend("old", env, image=OLD_IMAGE)
        else:
            old = start_backend("old", env, jar=boot_jar("old-source"))
        case("Exact old backend actual runtime readiness on V48", http_status=200, status="UP", mode=selection["mode"])
        after_startup = snapshot("after-old-startup")
        require(before == after_startup, "Old startup must leave complete schema, history, indexes, and quotation fixture unchanged")
        case("Old startup preserved schema V48, complete Flyway history, indexes and fixture")
        old_arrays = verify_arrays("old", bearer)
        require(candidate_arrays == old_arrays, "Old and candidate legacy quotation payloads must be identical, ignoring tied row ordering")
        case("Old and candidate complete quotation payload parity", total_quotations=102, total_child_items=204)
        after_reads = snapshot("after-old-reads")
        require(before == after_reads, "Old quotation reads must leave schema/history/index/fixture unchanged")
        case("Old reads preserved V48 schema/index/history and produced zero agent/cost rows")
        wait_ready(old)
        case("Old runtime remains ready after reads", http_status=200, status="UP")
        REPORT["result"] = "passed"
    finally:
        for name in CONTAINERS:
            logs = run(["docker", "logs", name], check=False)
            (EVIDENCE / (name + ".log")).write_text(logs.stdout + logs.stderr)
        write_json("summary.json", REPORT)
        if "GITHUB_STEP_SUMMARY" in os.environ:
            with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as summary:
                summary.write("## Isolated backend rollback compatibility\n\n")
                summary.write(f"Result: **{REPORT['result']}**\n\nCandidate: `{CANDIDATE}`\n\nOld: `{OLD}`\n\n")
                summary.write(f"Old runtime mode: `{selection['mode']}`. PostgreSQL 17, synthetic-only, internal network, Agent/Cost OFF.\n\n")
                for item in REPORT["cases"]:
                    summary.write(f"- PASS: {item['name']}\n")
                summary.write("\nScope: backend rollback on additive V48. Does not validate production load, infrastructure parity, or frontend compatibility with old backend.\n")
        # Delete only harness-owned disposable resources after evidence capture.
        for name in reversed(CONTAINERS):
            run(["docker", "rm", "-f", name], check=False)
        run(["docker", "network", "rm", NETWORK], check=False)


if __name__ == "__main__":
    if len(sys.argv) != 2 or sys.argv[1] not in {"resolve-image", "verify"}:
        raise SystemExit("usage: verify_runtime.py {resolve-image|verify}")
    if sys.argv[1] == "resolve-image":
        resolve_image()
    else:
        verify()
