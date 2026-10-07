"""Three independent cold processes per fixed language feasibility input, sequential."""
import csv
import hashlib
import json
import os
import signal
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

output = Path("/results")
plan = json.loads(Path("/probe-inputs/feasibility-plan.json").read_text())
rows, raw = [], []
all_passed = True

def proc_tree(pid):
    pids = [pid]
    for current in pids:
        try:
            pids.extend(int(v) for v in Path(f"/proc/{current}/task/{current}/children").read_text().split())
        except OSError:
            pass
    return pids

for setting in plan:
    if not all_passed:
        break  # Do not expand to other inputs/quality after a resource gate failure.
    payload = Path("/probe-inputs", setting["filename"]).read_bytes()
    assert hashlib.sha256(payload).hexdigest() == setting["sha256"]
    for repeat in (1, 2, 3):
        if datetime.now(timezone.utc).hour >= 7:
            raise SystemExit("Stop evaluation before 16:00 KST; preserve shutdown time.")
        before = time.monotonic()
        process = subprocess.Popen([sys.executable, "-I", "/opt/feasibility/worker_probe.py"], stdin=subprocess.PIPE,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True,
                                   env={"PATH": os.environ["PATH"], "PYTHONDONTWRITEBYTECODE": "1"})
        peak = {"rss_kib_sum": 0, "vms_kib_max": 0, "native_rss_kib": 0, "native_vms_kib": 0, "limits": {}}
        stop = threading.Event()
        def observe():
            while not stop.is_set():
                total = 0
                for pid in proc_tree(process.pid):
                    try:
                        status = dict(line.split(":", 1) for line in Path(f"/proc/{pid}/status").read_text().splitlines())
                        rss = int(status.get("VmRSS", "0 kB").split()[0]); vms = int(status.get("VmSize", "0 kB").split()[0])
                        total += rss
                        peak["vms_kib_max"] = max(peak["vms_kib_max"], vms)
                        peak["limits"][str(pid)] = Path(f"/proc/{pid}/limits").read_text()
                        if pid != process.pid:
                            peak["native_rss_kib"] = max(peak["native_rss_kib"], rss)
                            peak["native_vms_kib"] = max(peak["native_vms_kib"], vms)
                    except (OSError, ValueError):
                        pass
                peak["rss_kib_sum"] = max(peak["rss_kib_sum"], total)
                stop.wait(.02)
        thread = threading.Thread(target=observe, daemon=True); thread.start()
        try:
            stdout, stderr = process.communicate(payload, timeout=15)
            result = json.loads(stdout) if process.returncode == 0 else {"success": False, "error": f"WORKER_EXIT_{process.returncode}"}
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL); stdout, stderr = process.communicate()
            result = {"success": False, "error": "API_15SEC_TIMEOUT"}
        finally:
            stop.set(); thread.join(timeout=1)
            try: os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError: pass
        elapsed = time.monotonic() - before
        passed = bool(result["success"] and elapsed <= 8 and result["worker_wall_sec"] <= 8 and result["native_wrapper_sec"] <= 3)
        all_passed &= passed
        native = result.get("native", {})
        row = {"case": setting["case"], "repeat": repeat, "input_sha256": setting["sha256"],
               "gate_passed": passed, "success": result["success"], "worker_parent_wall_sec": elapsed,
               "worker_wall_sec": result.get("worker_wall_sec"), "native_wrapper_sec": result.get("native_wrapper_sec"),
               "native_import_sec": native.get("imports_sec"), "native_engine_init_sec": native.get("engine_init_sec"),
               "native_ocr_sec": native.get("ocr_sec"), "worker_peak_rss_kib": result.get("worker_peak_rss_kib"),
               "native_peak_rss_kib": result.get("native_peak_rss_kib"),
               "observed_rss_sum_kib": peak["rss_kib_sum"], "observed_native_vms_kib": peak["native_vms_kib"],
               "failure_stage": native.get("stage", result.get("stage")),
               "error_type": native.get("error_type", result.get("error_type", "")),
               "error": native.get("error", result.get("error", "")), "reason": result.get("reason", "")}
        rows.append(row); raw.append({"setting": setting, "repeat": repeat, "result": result, "observations": peak,
                                      "worker_stderr": stderr.decode(errors="replace")[:4000]})
        with (output / "rapidocr-feasibility.csv").open("w", encoding="utf-8-sig", newline="") as stream:
            writer = csv.DictWriter(stream, fieldnames=list(row)); writer.writeheader(); writer.writerows(rows)
        (output / "rapidocr-feasibility-raw.json").write_text(json.dumps(raw, ensure_ascii=False, indent=2))
        print(json.dumps(row, ensure_ascii=False), flush=True)
(output / "rapidocr-feasibility-decision.json").write_text(json.dumps({"gates_passed": all_passed, "trials": len(rows), "planned_inputs": len(plan), "tested_inputs": len({r["case"] for r in rows}), "expand_quality_evaluation": all_passed}, indent=2))
resource_snapshot = {}
for name in ("memory.peak", "memory.events", "memory.max", "cpu.max", "pids.max"):
    try:
        resource_snapshot[name] = Path("/sys/fs/cgroup", name).read_text().strip()
    except OSError:
        resource_snapshot[name] = None
(output / "rapidocr-container-cgroup.json").write_text(json.dumps(resource_snapshot, indent=2))
