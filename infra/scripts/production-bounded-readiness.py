#!/usr/bin/env python3
"""Bounded production readiness observation. Never authenticates or mutates data.

No secret/config reads, response-body logs, model calls, package installation,
service restart, configuration changes, or database writes. Fixed target allowlist.
This is NOT an application, quotation, or AI-model capacity benchmark.
"""
from __future__ import annotations
import concurrent.futures
import datetime
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request

EXPECTED_SHA = '9a48b5d18672f02fdcb30269b1dffc3f0a414d24'
TARGETS = {
    'backend_loopback_readiness': 'http://127.0.0.1:8080/actuator/health/readiness',
    'public_api_readiness_from_origin_host': 'https://api.freelance-ops.site/actuator/health/readiness',
}
PROJECT = 'freelance-ops-v2-production'
TIMEOUT = 3
MAX_CONCURRENT = 5
STAGE_SECONDS = 30
RATES = (1, 2, 5)

class Abort(RuntimeError):
    pass

def emit(event, **data):
    print(json.dumps({'event': event, 'utc': datetime.datetime.now(datetime.timezone.utc).isoformat(), **data}, sort_keys=True), flush=True)

def command(args, timeout=10):
    result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout, check=False)
    if result.returncode:
        raise Abort('allowlisted_command_failed_' + Path(args[0]).name)
    return result.stdout.decode().strip()

def container(project, service):
    result = command(['docker', 'ps', '--filter', 'label=com.docker.compose.project=' + project,
                      '--filter', 'label=com.docker.compose.service=' + service, '--format', '{{.ID}}']).splitlines()
    if len(result) != 1 or not re.fullmatch(r'[a-f0-9]{12,64}', result[0]):
        raise Abort('running_container_missing_' + service)
    return result[0]

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

OPENER = urllib.request.build_opener(NoRedirect())

def request(name):
    start = time.monotonic()
    code, up = 0, False
    try:
        req = urllib.request.Request(TARGETS[name], headers={'User-Agent': 'FreelanceOps-BoundedReadiness/1.0'})
        with OPENER.open(req, timeout=TIMEOUT) as response:
            code = response.status
            # Parse only the public status field. Never retain or print raw bodies.
            up = json.loads(response.read(4096)).get('status') == 'UP'
    except urllib.error.HTTPError as error:
        code = error.code
        error.close()
    except Exception:
        pass
    return {'status': code, 'up': up, 'ms': round((time.monotonic() - start) * 1000, 3)}

def cpu_ticks():
    values = [int(x) for x in Path('/proc/stat').read_text().splitlines()[0].split()[1:9]]
    return sum(values), values[3] + values[4]

def resources():
    before = cpu_ticks()
    time.sleep(0.5)
    after = cpu_ticks()
    delta = after[0] - before[0]
    cpu = 100 * (1 - (after[1] - before[1]) / delta) if delta else 0
    memory = {line.split(':')[0]: int(line.split()[1]) * 1024 for line in Path('/proc/meminfo').read_text().splitlines() if ':' in line and len(line.split()) > 1}
    disk = shutil.disk_usage('/opt/freelance-ops')
    return {'cpu_percent': round(cpu, 2), 'cpu_count': os.cpu_count(), 'load1': os.getloadavg()[0],
            'memory_total_mib': round(memory['MemTotal']/1048576, 2),
            'memory_available_mib': round(memory['MemAvailable']/1048576, 2),
            'memory_available_percent': round(100*memory['MemAvailable']/memory['MemTotal'], 2),
            'swap_used_mib': round((memory.get('SwapTotal', 0)-memory.get('SwapFree', 0))/1048576, 2),
            'disk_free_gib': round(disk.free/1073741824, 2), 'disk_free_percent': round(disk.free/disk.total*100, 2)}

DB_QUERY = """
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='2s';
SET LOCAL lock_timeout='500ms';
SELECT json_build_object(
 'max_connections',current_setting('max_connections')::int,
 'connections_total',(SELECT count(*) FROM pg_stat_activity),
 'app_connections',(SELECT count(*) FROM pg_stat_activity WHERE usename='app_user'),
 'app_active_connections',(SELECT count(*) FROM pg_stat_activity WHERE usename='app_user' AND state='active'),
 'app_idle_connections',(SELECT count(*) FROM pg_stat_activity WHERE usename='app_user' AND state='idle'),
 'app_waiting_connections',(SELECT count(*) FROM pg_stat_activity WHERE usename='app_user' AND wait_event_type='Lock'),
 'app_active_runs',(SELECT count(*) FROM app.agent_run WHERE status IN ('QUEUED','RUNNING')),
 'app_pending_commands',(SELECT count(*) FROM app.agent_run_command WHERE status IN ('PENDING','PROCESSING')),
 'runtime_active_runs',(SELECT count(*) FROM agent_runtime.agent_run_state WHERE status IN ('QUEUED','RUNNING')),
 'runtime_waiting_runs',(SELECT count(*) FROM agent_runtime.agent_run_state WHERE status='WAITING_FOR_USER'),
 'unfinished_tasks',(SELECT count(*) FROM agent_runtime.agent_task WHERE status IN ('SUBMITTED','ADMITTED','DEFERRED','QUEUED','RUNNING','CHECKPOINTED','PAUSED','RETRY_WAIT','WAITING_FOR_CAPACITY')),
 'pending_scheduler_entries',(SELECT count(*) FROM agent_runtime.agent_scheduler_entry WHERE entry_status IN ('PENDING','CLAIMED')),
 'schema_version',(SELECT max(version::int) FROM app.flyway_schema_history WHERE success AND version ~ '^[0-9]+$')
);
COMMIT;
"""

def db_metrics(postgres):
    raw = command(['docker', 'exec', postgres, 'psql', '-X', '-qAt', '--username', 'postgres', '--dbname', 'freelance_ops', '--set', 'ON_ERROR_STOP=1', '--command', DB_QUERY], timeout=6)
    data = json.loads(raw)
    if not isinstance(data, dict) or any(type(value) is not int or value < 0 for value in data.values()):
        raise Abort('aggregate_metrics_shape_invalid')
    return data

def container_states(containers):
    result = {}
    for service, cid in containers.items():
        # Do not read docker Config.Env, arbitrary inspect data, or .env files.
        values = command(['docker', 'inspect', '--format', '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}|{{.Config.Image}}', cid]).split('|')
        if len(values) != 3 or values[0] != 'running' or values[1] != 'healthy':
            raise Abort('container_not_healthy_' + service)
        if service in ('backend', 'agent') and not values[2].endswith(':' + service + '-' + EXPECTED_SHA):
            raise Abort('image_pin_changed_' + service)
        result[service] = {'running': True, 'healthy': True}
    return result

def check_safety(metrics, db):
    if metrics['cpu_percent'] >= 85:
        raise Abort('host_cpu_at_least_85_percent')
    if metrics['load1'] >= 2 * metrics['cpu_count']:
        raise Abort('host_load_exceeds_two_per_cpu')
    if metrics['memory_available_percent'] < 15 or metrics['memory_available_mib'] < 128:
        raise Abort('host_memory_headroom_low')
    if metrics['disk_free_percent'] < 10 or metrics['disk_free_gib'] < 1:
        raise Abort('host_disk_headroom_low')
    if db['connections_total'] >= .8 * db['max_connections'] or db['app_waiting_connections']:
        raise Abort('database_connection_pressure')
    for key in ('app_active_runs', 'app_pending_commands', 'runtime_active_runs', 'unfinished_tasks', 'pending_scheduler_entries'):
        if db[key]:
            raise Abort('active_work_present_' + key)
    if db['schema_version'] != 47:
        raise Abort('unexpected_schema')

def observe(containers, postgres):
    states = container_states(containers)
    metrics = resources()
    db = db_metrics(postgres)
    health = request('backend_loopback_readiness')
    emit('observation', resources=metrics, database=db, containers=states, readiness=health)
    if health['status'] != 200 or not health['up']:
        raise Abort('readiness_not_up')
    check_safety(metrics, db)
    return metrics, db

def percentile(values, pct):
    return sorted(values)[max(0, math.ceil(len(values) * pct / 100) - 1)] if values else None

def summarize(records, elapsed):
    statuses = {}
    for item in records:
        statuses[str(item['status'])] = statuses.get(str(item['status']), 0) + 1
    values = [item['ms'] for item in records]
    return {'requests': len(records), 'elapsed_seconds': round(elapsed, 3),
            'achieved_rps': round(len(records)/elapsed, 3) if elapsed else 0,
            'p50_ms': percentile(values, 50), 'p95_ms': percentile(values, 95), 'p99_ms': percentile(values, 99),
            'max_ms': max(values) if values else None, 'statuses': statuses,
            'errors': sum(x['status'] != 200 or not x['up'] for x in records)}

def stage(name, rps, containers, postgres, baseline, campaign_start):
    records, pending = [], set()
    start = time.monotonic()
    next_request, next_observation = start, start + 5
    launched = 0
    emit('stage_start', target=name, target_rps=rps, seconds=STAGE_SECONDS, max_concurrent=min(rps, MAX_CONCURRENT))
    with concurrent.futures.ThreadPoolExecutor(max_workers=min(rps, MAX_CONCURRENT)) as pool:
        try:
            while time.monotonic() - start < STAGE_SECONDS or pending:
                now = time.monotonic()
                if now - campaign_start > 240:
                    raise Abort('hard_campaign_deadline_240_seconds')
                for future in list(pending):
                    if future.done():
                        item = future.result()
                        pending.remove(future)
                        records.append(item)
                        if item['status'] != 200 or not item['up']:
                            raise Abort('request_error_or_health_not_up')
                if len(records) >= 10:
                    recent_p95 = percentile([x['ms'] for x in records[-30:]], 95)
                    if recent_p95 > (max(250, 3 * baseline) if baseline else 1000):
                        raise Abort('rolling_p95_exceeds_guardrail')
                if now >= next_observation:
                    observe(containers, postgres)
                    next_observation = time.monotonic() + 5
                now = time.monotonic()
                if now - start < STAGE_SECONDS and now >= next_request and launched < rps * STAGE_SECONDS:
                    if len(pending) >= min(rps, MAX_CONCURRENT):
                        raise Abort('requested_rate_exceeds_concurrency_cap')
                    pending.add(pool.submit(request, name))
                    launched += 1
                    # Never catch up with a burst after an observation delay.
                    next_request = now + 1/rps
                time.sleep(.01)
        except Exception:
            for future in pending:
                future.cancel()
            emit('stage_aborted', target=name, target_rps=rps, summary=summarize(records, time.monotonic()-start))
            raise
    summary = summarize(records, time.monotonic()-start)
    emit('stage_complete', target=name, target_rps=rps, summary=summary)
    observe(containers, postgres)
    return summary

def main(mode):
    if mode not in ('preflight', 'campaign'):
        raise Abort('unknown_mode')
    emit('scope', mode=mode, targets=TARGETS, rates=RATES, stage_seconds=STAGE_SECONDS,
         max_concurrent=MAX_CONCURRENT, max_campaign_seconds=240,
         authenticated_business_api='BLOCKED_no_existing_authorized_session',
         hikari_instrumentation='UNAVAILABLE_metrics_denyAll_unchanged',
         database_sessions='aggregate_proxy_not_hikari_wait_time',
         public_measurement_origin='production_host_not_geographic_user_edge',
         actual_ai_model_performance='NOT_TESTED')
    containers = {name: container(PROJECT, name) for name in ('backend', 'agent')}
    postgres = container('freelance-ops-v2-infra', 'postgres')
    containers['postgres'] = postgres
    observe(containers, postgres)
    edge = request('public_api_readiness_from_origin_host')
    emit('public_preflight', readiness=edge)
    if edge['status'] != 200 or not edge['up']:
        raise Abort('public_preflight_not_up')
    emit('preflight_passed')
    if mode == 'preflight':
        return
    start = time.monotonic()
    summaries = []
    for name in TARGETS:
        baseline = None
        for rps in RATES:
            result = stage(name, rps, containers, postgres, baseline, start)
            summaries.append({'target': name, 'target_rps': rps, **result})
            if baseline is None:
                baseline = result['p95_ms']
    emit('campaign_complete', stages=summaries, elapsed_seconds=round(time.monotonic()-start, 3), abort_status='NOT_ABORTED')

if __name__ == '__main__':
    try:
        main(sys.argv[1] if len(sys.argv) == 2 else '')
    except Abort as error:
        emit('aborted', reason=str(error))
        sys.exit(2)
    except Exception as error:
        # Exception text can contain connection details. Report class only.
        emit('aborted', reason='unexpected_' + type(error).__name__)
        sys.exit(2)
