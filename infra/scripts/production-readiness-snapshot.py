#!/usr/bin/env python3
"""Observe reviewed production metadata and retain one local recovery archive.

Uses only the existing deployment identity. Does not read configuration/key
values, deploy, alter the database, restore an archive, or transfer it off-host.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import time

DEPLOY_ROOT = Path('/opt/freelance-ops')
BACKUP_ROOT = Path('/var/backups/freelance-ops')
PROJECT = 'freelance-ops-v2-production'
EXPECTED = {
    'backend': '775b92c8dbaafbdd21438140d4238e39e1aa8ef1',
    'agent': '9a48b5d18672f02fdcb30269b1dffc3f0a414d24',
}
SHA = re.compile(r'[0-9a-f]{40}')
DIGEST = re.compile(r'sha256:[0-9a-f]{64}')


def command(args, *, input_file=None, output_file=None, timeout=30):
    result = subprocess.run(args, stdin=input_file,
                            stdout=output_file if output_file is not None else subprocess.PIPE,
                            stderr=subprocess.PIPE, timeout=timeout, check=False)
    if result.returncode:
        raise RuntimeError(f'{Path(args[0]).name}_failed_exit_{result.returncode}')
    return '' if output_file is not None else result.stdout.decode('utf-8').strip()


def container(project, service):
    ids = command(['docker', 'ps', '--filter', f'label=com.docker.compose.project={project}',
                   '--filter', f'label=com.docker.compose.service={service}',
                   '--format', '{{.ID}}']).splitlines()
    if len(ids) != 1 or not re.fullmatch(r'[0-9a-f]{12,64}', ids[0]):
        raise RuntimeError(f'exactly_one_{service}_container_required')
    return ids[0]


CONTAINER_FORMAT = ('{"tag":{{json .Config.Image}},"image_id":{{json .Image}},'
                    '"state":{{json .State.Status}},'
                    '"health":{{json .State.Health.Status}},'
                    '"oom_killed":{{json .State.OOMKilled}},'
                    '"restart_count":{{json .RestartCount}}}')


def image_metadata(service, cid):
    # The Docker CLI never returns .Config.Env or health-command output.
    data = json.loads(command(['docker', 'inspect', '--format', CONTAINER_FORMAT, cid]))
    prefix = f'ghcr.io/jomkeu3369/freelance-ops-{service}'
    if not re.fullmatch(re.escape(prefix) + ':' + service + r'-[0-9a-f]{40}', data.get('tag', '')):
        raise RuntimeError(f'{service}_tag_shape_invalid')
    if not DIGEST.fullmatch(data.get('image_id', '')):
        raise RuntimeError(f'{service}_image_id_invalid')
    marker = (DEPLOY_ROOT / f'.{service}-deployed-tag').read_text().strip()
    if not re.fullmatch(service + r'-[0-9a-f]{40}', marker):
        raise RuntimeError(f'{service}_marker_shape_invalid')
    digests = json.loads(command(['docker', 'image', 'inspect', '--format',
                                 '{{json .RepoDigests}}', data['image_id']])) or []
    if any(not re.fullmatch(re.escape(prefix) + r'@sha256:[0-9a-f]{64}', x) for x in digests):
        raise RuntimeError(f'{service}_repo_digest_shape_invalid')
    if data.get('state') not in ('running', 'exited', 'restarting', 'created', 'paused', 'dead', 'removing'):
        raise RuntimeError(f'{service}_state_shape_invalid')
    if data.get('health') not in ('healthy', 'unhealthy', 'starting'):
        raise RuntimeError(f'{service}_health_shape_invalid')
    if type(data.get('oom_killed')) is not bool or type(data.get('restart_count')) is not int:
        raise RuntimeError(f'{service}_state_counters_invalid')
    return {**data, 'marker': marker, 'marker_matches': marker == data['tag'].rsplit(':', 1)[1],
            'repo_digests': digests}


DB_QUERY = """
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='3s';
SET LOCAL lock_timeout='500ms';
SELECT json_build_object(
 'max_connections',current_setting('max_connections')::int,
 'connections_total',(SELECT count(*) FROM pg_stat_activity),
 'waiting_locks',(SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'),
 'idle_in_transaction',(SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND state LIKE 'idle in transaction%'),
 'prepared_transactions',(SELECT count(*) FROM pg_prepared_xacts WHERE database=current_database()),
 'app_active_runs',(SELECT count(*) FROM app.agent_run WHERE status IN ('QUEUED','RUNNING')),
 'app_waiting_runs',(SELECT count(*) FROM app.agent_run WHERE status='WAITING_FOR_USER'),
 'app_pending_commands',(SELECT count(*) FROM app.agent_run_command WHERE status IN ('PENDING','PROCESSING')),
 'runtime_active_runs',(SELECT count(*) FROM agent_runtime.agent_run_state WHERE status IN ('QUEUED','RUNNING')),
 'runtime_waiting_runs',(SELECT count(*) FROM agent_runtime.agent_run_state WHERE status='WAITING_FOR_USER'),
 'runtime_orphan_waiting_runs',(SELECT count(*) FROM agent_runtime.agent_run_state r LEFT JOIN app.agent_run a ON a.id=r.run_id WHERE r.status='WAITING_FOR_USER' AND a.id IS NULL),
 'unfinished_tasks',(SELECT count(*) FROM agent_runtime.agent_task WHERE status IN ('SUBMITTED','ADMITTED','DEFERRED','QUEUED','RUNNING','CHECKPOINTED','PAUSED','RETRY_WAIT','WAITING_FOR_CAPACITY')),
 'unfinished_attempts',(SELECT count(*) FROM agent_runtime.agent_task_attempt WHERE status IN ('PREDICTED','QUEUED','RUNNING','CHECKPOINTED')),
 'pending_scheduler_entries',(SELECT count(*) FROM agent_runtime.agent_scheduler_entry WHERE entry_status IN ('PENDING','CLAIMED')),
 'schema_version',(SELECT coalesce(max(version::int),0) FROM app.flyway_schema_history WHERE success AND version ~ '^[0-9]+$'),
 'failed_migrations',(SELECT count(*) FROM app.flyway_schema_history WHERE NOT success),
 'database_size_bytes',pg_database_size(current_database()),
 'postgres_version_num',current_setting('server_version_num')::int
);
COMMIT;
"""
DB_KEYS = frozenset(('max_connections', 'connections_total', 'waiting_locks',
    'idle_in_transaction', 'prepared_transactions', 'app_active_runs', 'app_waiting_runs',
    'app_pending_commands', 'runtime_active_runs', 'runtime_waiting_runs',
    'runtime_orphan_waiting_runs', 'unfinished_tasks', 'unfinished_attempts',
    'pending_scheduler_entries', 'schema_version', 'failed_migrations',
    'database_size_bytes', 'postgres_version_num'))


def psql(postgres, query):
    return command(['docker', 'exec', postgres, 'psql', '-X', '-qAt', '--username',
                    'postgres', '--dbname', 'freelance_ops', '--set', 'ON_ERROR_STOP=1',
                    '--command', query], timeout=8)


def db_metadata(postgres):
    data = json.loads(psql(postgres, DB_QUERY))
    if set(data) != DB_KEYS or any(type(x) is not int or x < 0 for x in data.values()):
        raise RuntimeError('aggregate_metadata_shape_invalid')
    return data


def resources():
    def ticks():
        values = [int(x) for x in Path('/proc/stat').read_text().splitlines()[0].split()[1:9]]
        return sum(values), values[3] + values[4]
    before = ticks()
    time.sleep(.5)
    after = ticks()
    delta = after[0] - before[0]
    memory = {line.split(':')[0]: int(line.split()[1]) * 1024
              for line in Path('/proc/meminfo').read_text().splitlines()
              if ':' in line and len(line.split()) > 1}
    disk = shutil.disk_usage(DEPLOY_ROOT)
    return {'cpu_count': os.cpu_count(), 'load1': os.getloadavg()[0],
            'cpu_percent': round(100 * (1 - (after[1]-before[1])/delta), 2) if delta else 0,
            'memory_available_mib': round(memory['MemAvailable']/1048576, 2),
            'memory_available_percent': round(100*memory['MemAvailable']/memory['MemTotal'], 2),
            'disk_free_gib': round(disk.free/1073741824, 2),
            'disk_free_percent': round(100*disk.free/disk.total, 2)}


def readiness(url):
    data = json.loads(command(['curl', '--fail', '--silent', '--show-error', '--max-time', '5', url], timeout=7))
    if data.get('status') != 'UP':
        raise RuntimeError('backend_readiness_not_up')
    return 'UP'


def snapshot_safety(observation):
    for service, image in observation['images'].items():
        if image['tag'] != f'ghcr.io/jomkeu3369/freelance-ops-{service}:{service}-{EXPECTED[service]}':
            raise RuntimeError(f'{service}_reviewed_version_changed')
        if not image['marker_matches'] or image['health'] != 'healthy' or image['state'] != 'running':
            raise RuntimeError(f'{service}_marker_or_health_not_ready')
        if image['oom_killed']:
            raise RuntimeError(f'{service}_oom_killed')
    data, host = observation['database'], observation['resources']
    if data['schema_version'] != 48 or data['failed_migrations']:
        raise RuntimeError('reviewed_schema48_required')
    if observation['alembic_version'] != '20260912_0007':
        raise RuntimeError('reviewed_alembic_required')
    if host['cpu_percent'] >= 85 or host['load1'] >= 2*host['cpu_count']:
        raise RuntimeError('host_cpu_pressure')
    if host['memory_available_percent'] < 15 or host['memory_available_mib'] < 128:
        raise RuntimeError('host_memory_pressure')
    if host['disk_free_percent'] < 10 or host['disk_free_gib'] < 1:
        raise RuntimeError('host_disk_pressure')
    if data['connections_total'] >= .8*data['max_connections']:
        raise RuntimeError('database_connection_pressure')
    for key in ('waiting_locks', 'idle_in_transaction', 'prepared_transactions',
                'app_active_runs', 'app_pending_commands', 'runtime_active_runs',
                'unfinished_tasks', 'unfinished_attempts', 'pending_scheduler_entries'):
        if data[key]:
            raise RuntimeError('work_or_pressure_present_' + key)
    # Waiting/orphan data is reported and preserved, never cancelled or reset.
    if data['database_size_bytes'] > 4*1024**3:
        raise RuntimeError('database_exceeds_bounded_snapshot_window')


def checksum(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024*1024), b''):
            digest.update(block)
    return digest.hexdigest()


def retain_snapshot(postgres, validation_sha, observation):
    snapshot_safety(observation)
    BACKUP_ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = BACKUP_ROOT.stat()
    if BACKUP_ROOT.is_symlink() or info.st_uid != 0 or stat.S_IMODE(info.st_mode) & 0o022:
        raise RuntimeError('backup_root_must_be_existing_secure_root_owned_path')
    if shutil.disk_usage(BACKUP_ROOT).free < observation['database']['database_size_bytes'] + 1024**3:
        raise RuntimeError('backup_storage_headroom_low')
    timestamp = dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    snapshot = BACKUP_ROOT / f'readiness_{timestamp}_{validation_sha[:12]}'
    snapshot.mkdir(mode=0o700, exist_ok=False)
    dump = snapshot / 'freelance_ops.dump'
    with dump.open('xb') as stream:
        command(['docker', 'exec', postgres, 'pg_dump', '--username', 'postgres',
                 '--dbname', 'freelance_ops', '--format', 'custom', '--lock-wait-timeout=10s'],
                output_file=stream, timeout=600)
    if stat.S_IMODE(snapshot.stat().st_mode) != 0o700 or stat.S_IMODE(dump.stat().st_mode) != 0o600 or not dump.stat().st_size:
        raise RuntimeError('archive_permissions_or_size_invalid')
    catalog = snapshot / 'archive.catalog'
    with dump.open('rb') as source, catalog.open('xb') as target:
        command(['docker', 'exec', '-i', postgres, 'pg_restore', '--list'],
                input_file=source, output_file=target, timeout=60)
    if not catalog.stat().st_size or stat.S_IMODE(catalog.stat().st_mode) != 0o600:
        raise RuntimeError('catalog_permissions_or_size_invalid')
    # Decode the entire custom archive to /dev/null; no database connection/restore.
    with dump.open('rb') as source:
        command(['docker', 'exec', '-i', postgres, 'pg_restore', '--exit-on-error', '--file=/dev/null'],
                input_file=source, timeout=600)
    digest = checksum(dump)
    (snapshot / 'freelance_ops.dump.sha256').write_text(digest + '  freelance_ops.dump\n')
    if checksum(dump) != digest:
        raise RuntimeError('archive_checksum_changed')
    result = {'snapshot_path': str(dump), 'snapshot_bytes': dump.stat().st_size,
              'snapshot_sha256': digest, 'created_at_utc': timestamp,
              'snapshot_directory_mode': '0700', 'snapshot_file_mode': '0600',
              'archive_catalog_verified': True, 'archive_fully_decoded': True,
              'checksum_rechecked': True, 'validation_sha': validation_sha,
              'off_host_transfer_performed': False, 'database_restore_performed': False,
              'deployment_or_migration_performed': False, 'secret_values_read': False,
              'observation': observation}
    (snapshot / 'release-metadata.json').write_text(json.dumps(result, indent=2) + '\n')
    return result


def main(validation_sha):
    if not SHA.fullmatch(validation_sha):
        raise ValueError('full_validation_commit_sha_required')
    if os.geteuid() != 0:
        raise RuntimeError('existing_root_deployment_identity_required')
    os.umask(0o077)
    postgres = container('freelance-ops-v2-infra', 'postgres')
    images = {service: image_metadata(service, container(PROJECT, service))
              for service in ('backend', 'agent')}
    observation = {'observed_at_utc': dt.datetime.now(dt.timezone.utc).isoformat(),
                   'images': images, 'database': db_metadata(postgres),
                   'resources': resources(),
                   'alembic_version': psql(postgres, "BEGIN READ ONLY; SET LOCAL statement_timeout='3s'; SELECT version_num FROM agent_runtime.alembic_version; COMMIT;"),
                   'backend_readiness': readiness('http://127.0.0.1:8080/actuator/health/readiness'),
                   'public_backend_readiness': readiness('https://api.freelance-ops.site/actuator/health/readiness')}
    if not re.fullmatch(r'[0-9]{8}_[0-9]{4}', observation['alembic_version']):
        raise RuntimeError('alembic_metadata_shape_invalid')
    # Print allowlisted metadata before checking pins, so a changed state remains visible.
    print(json.dumps({'current_production_observation': observation}, sort_keys=True), flush=True)
    result = retain_snapshot(postgres, validation_sha, observation)
    print(json.dumps({'fresh_local_snapshot': result}, sort_keys=True), flush=True)


if __name__ == '__main__':
    try:
        if len(sys.argv) != 2:
            raise ValueError('usage_production_readiness_snapshot_py_commit_sha')
        main(sys.argv[1])
    except Exception as exc:
        # Never relay arbitrary subprocess output, archive contents or env values.
        detail = str(exc) if type(exc) in (RuntimeError, ValueError) else 'operation_failed'
        print(json.dumps({'readiness_stopped': detail}), file=sys.stderr)
        sys.exit(1)
