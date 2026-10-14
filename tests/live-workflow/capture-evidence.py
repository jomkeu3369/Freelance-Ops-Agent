"""Read only sanitized domain metadata from the owned live-test database."""

import json
import os
import sys
from pathlib import Path
from uuid import UUID

import psycopg

dsn = os.environ["LIVE_DB_DSN"]
target = psycopg.conninfo.conninfo_to_dict(dsn)
if target.get("host") != "127.0.0.1" or not 18200 <= int(target["port"]) <= 18249:
    raise RuntimeError("Evidence capture requires the isolated loopback test database")

results = Path(sys.argv[1]).resolve()
destination = Path(sys.argv[2]).resolve()
cases = []
with psycopg.connect(dsn) as database:
    version = database.execute("select version()").fetchone()[0]
    vector = database.execute(
        "select extversion from pg_extension where extname='vector'"
    ).fetchone()[0]
    for file in sorted(results.rglob("workflow-evidence.json")):
        case = json.loads(file.read_text(encoding="utf-8"))
        run_id = UUID(case["sourceRunId"])
        events = database.execute(
            "select event_id,type from agent_runtime.agent_run_event "
            "where run_id=%s order by event_id",
            (run_id,),
        ).fetchall()
        state = database.execute(
            "select status, error_code from agent_runtime.agent_run_state where run_id=%s",
            (run_id,),
        ).fetchone()
        specification = database.execute(
            "select status, revision_number, content_hash from app.specification where id=%s",
            (UUID(case["confirmedSpecificationId"]),),
        ).fetchone()
        if state[0] != "COMPLETED" or specification[0] != "CONFIRMED":
            raise RuntimeError("The recorded workflow has no durable confirmed result")
        cases.append(
            {
                "projectId": case["projectId"],
                "runId": str(run_id),
                "selectedOpinions": case["selectedOpinions"],
                "persistedRunStatus": state[0],
                "errorCode": state[1],
                "confirmedSpecificationId": case["confirmedSpecificationId"],
                "specificationStatus": specification[0],
                "specificationRevision": specification[1],
                "specificationHash": specification[2],
                "events": [{"id": index, "type": kind} for index, kind in events],
            }
        )
if len(cases) != 3:
    raise RuntimeError("Capture evidence after all three browser journeys have passed")
destination.parent.mkdir(parents=True, exist_ok=True)
destination.write_text(
    json.dumps({"postgres": version, "pgvector": vector, "cases": cases}, indent=2),
    encoding="utf-8",
)
print(f"Captured {len(cases)} durable localhost workflows")
