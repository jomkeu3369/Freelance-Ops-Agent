#!/usr/bin/env python3
"""Read production state and retain a local, owner-only pre-migration snapshot.

Never deploys, changes configuration, restores data, creates credentials, or sends
production data off-host. Only allowlisted metadata is written to stdout.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import stat
import time

DEPLOY_ROOT = Path('/opt/freelance-ops')
BACKUP_ROOT = Path('/var/backups/freelance-ops')
PROJECT = 'freelance-ops-v2-production'
EXPECTED_CURRENT_SHAS = {
    'backend': '9a48b5d18672f02fdcb30269b1dffc3f0a414d24',
    'agent': '9a48b5d18672f02fdcb30269b1dffc3f0a414d24',
}
APPROVED_RELEASE_CANDIDATE_SHA = '910a86f9c8f45577a7dc37a2dfd96b26502970eb'
SHA = re.compile(r'[0-9a-f]{40}')
DIGEST = re.compile(r'sha256:[0-9a-f]{64}')


def command(args: list[str], *, input_file=None, output_file=None, timeout=30) -> str:
    result = subprocess.run(args, stdin=input_file, stdout=output_file or subprocess.PIPE,
                            stderr=subprocess.PIPE, timeout=timeout, check=False)
    if result.returncode:
        # Do not relay arbitrary production output or secret-bearing error text.
        raise RuntimeError(f'{Path(args[0]).name} operation failed (exit {result.returncode})')
    return '' if output_file else result.stdout.decode('utf-8').strip()


def container(project: str, service: str) -> str:
    ids = command(['docker', 'ps', '--filter', f'label=com.docker.compose.project={project}',
                   '--filter', f'label=com.docker.compose.service={service}',
                   '--format', '{{.ID}}']).splitlines()
    if len(ids) != 1 or not re.fullmatch(r'[0-9a-f]{12,64}', ids[0]):
        raise RuntimeError(f'Expected exactly one running {service} container')
    return ids[0]


def environment(entries: list[str]) -> dict[str, str]:
    return dict(entry.split('=', 1) for entry in entries if '=' in entry)


def safe_configuration(env: dict[str, str]) -> dict[str, bool]:
    def disabled(name: str) -> bool:
        return env.get(name, 'false').strip().lower() in ('', 'false', '0', 'no')
    return {
        'byok_key_present': bool(env.get('APP_BYOK_ENCRYPTION_KEY')),
        'platform_spend_disabled': disabled('PLATFORM_AI_SPEND_ENABLED'),
        'notice_dispatch_disabled': disabled('APP_NOTICES_DISPATCH_ENABLED'),
        'email_verification_activation_disabled': disabled('APP_AUTH_EMAIL_VERIFICATION_REQUIRED'),
        'production_origin_allowed': 'https://www.freelance-ops.site' in
            [x.strip() for x in env.get('APP_CORS_ALLOWED_ORIGINS', '').split(',')],
        'spring_application_json_absent': not bool(env.get('SPRING_APPLICATION_JSON')),
    }


def env_key_present(path: Path, key: str) -> bool:
    # Check only whether an existing backup destination is configured. Never echo
    # the .env, destination, passwords, tokens, or unrelated variables.
    if not path.is_file():
        return False
    with path.open() as stream:
        for line in stream:
            if line.startswith(key + '='):
                value = line.split('=', 1)[1].strip().strip('\"\'')
                return bool(value)
    return False


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()

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
        raise RuntimeError('aggregate_metrics_shape_invalid')
    return data

def check_safety(metrics, db):
    if metrics['cpu_percent'] >= 85:
        raise RuntimeError('host_cpu_at_least_85_percent')
    if metrics['load1'] >= 2 * metrics['cpu_count']:
        raise RuntimeError('host_load_exceeds_two_per_cpu')
    if metrics['memory_available_percent'] < 15 or metrics['memory_available_mib'] < 128:
        raise RuntimeError('host_memory_headroom_low')
    if metrics['disk_free_percent'] < 10 or metrics['disk_free_gib'] < 1:
        raise RuntimeError('host_disk_headroom_low')
    if db['connections_total'] >= .8 * db['max_connections'] or db['app_waiting_connections']:
        raise RuntimeError('database_connection_pressure')
    for key in ('app_active_runs', 'app_pending_commands', 'runtime_active_runs', 'unfinished_tasks', 'pending_scheduler_entries'):
        if db[key]:
            raise RuntimeError('active_work_present_' + key)
    if db['schema_version'] != 47:
        raise RuntimeError('unexpected_schema')

MIGRATION_METADATA_QUERY = """
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='2s';
SET LOCAL lock_timeout='500ms';
SELECT json_build_object(
 'postgres_version_num',current_setting('server_version_num')::int,
 'quotation_heap_bytes',pg_relation_size('app.quotation'),
 'quotation_total_bytes',pg_total_relation_size('app.quotation'),
 'quotation_index_bytes',pg_indexes_size('app.quotation'),
 'quotation_estimated_rows',(SELECT reltuples::bigint FROM pg_class WHERE oid='app.quotation'::regclass),
 'quotation_stat_live_rows',(SELECT n_live_tup FROM pg_stat_user_tables WHERE relid='app.quotation'::regclass),
 'quotation_stat_dead_rows',(SELECT n_dead_tup FROM pg_stat_user_tables WHERE relid='app.quotation'::regclass),
 'quotation_indexes',(SELECT COALESCE(json_agg(json_build_object(
   'name',c.relname,'method',am.amname,'bytes',pg_relation_size(i.indexrelid),
   'valid',i.indisvalid,'ready',i.indisready,'unique',i.indisunique,
   'has_expressions',i.indexprs IS NOT NULL,'has_predicate',i.indpred IS NOT NULL,
   'columns',(SELECT json_agg(a.attname ORDER BY k.ordinality) FROM unnest(i.indkey) WITH ORDINALITY k(attnum,ordinality)
    LEFT JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum)
  ) ORDER BY c.relname),'[]'::json) FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
  JOIN pg_am am ON am.oid=c.relam WHERE i.indrelid='app.quotation'::regclass),
 'quotation_locks',(SELECT COALESCE(json_agg(json_build_object('mode',mode,'granted',granted,'count',n)),'[]'::json)
  FROM (SELECT mode,granted,count(*) n FROM pg_locks WHERE relation='app.quotation'::regclass GROUP BY mode,granted) l),
 'quotation_conflicting_locks',(SELECT count(*) FROM pg_locks WHERE relation='app.quotation'::regclass
  AND mode IN ('RowExclusiveLock','ShareUpdateExclusiveLock','ShareRowExclusiveLock','ExclusiveLock','AccessExclusiveLock')),
 'other_open_transactions',(SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND xact_start IS NOT NULL),
 'other_oldest_transaction_seconds',(SELECT COALESCE(ceil(max(EXTRACT(EPOCH FROM clock_timestamp()-xact_start))),0)::bigint FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND xact_start IS NOT NULL),
 'idle_in_transaction',(SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND state LIKE 'idle in transaction%'),
 'lock_waiting_sessions',(SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'),
 'prepared_transactions',(SELECT count(*) FROM pg_prepared_xacts WHERE database=current_database()),
 'configured_timeouts',(SELECT COALESCE(json_agg(json_build_object(
  'scope',CASE WHEN r.setrole=0 THEN 'database' ELSE 'app_user' END,'setting',v.setting)),'[]'::json)
  FROM pg_db_role_setting r CROSS JOIN LATERAL unnest(r.setconfig) v(setting)
  WHERE r.setdatabase IN (0,(SELECT oid FROM pg_database WHERE datname=current_database()))
  AND r.setrole IN (0,(SELECT oid FROM pg_roles WHERE rolname='app_user'))
  AND v.setting ~ '^(statement_timeout|lock_timeout|idle_in_transaction_session_timeout)=[0-9]+(ms|s|min|h|d)?$')
);
COMMIT;
"""


def migration_preflight(postgres):
    host = resources()
    database = db_metrics(postgres)
    catalog = json.loads(command(['docker','exec',postgres,'psql','-X','-qAt',
        '--username','postgres','--dbname','freelance_ops','--set','ON_ERROR_STOP=1',
        '--command',MIGRATION_METADATA_QUERY],timeout=6))
    result = {'resources': host, 'database': database, 'migration_metadata': catalog}
    print(json.dumps({'pre_backup_observation': result}, sort_keys=True), flush=True)
    check_safety(host, database)
    if any(catalog[key] for key in ('quotation_conflicting_locks','idle_in_transaction',
                                   'lock_waiting_sessions','prepared_transactions')):
        raise RuntimeError('Database migration preflight has locks or unfinished transactions; review before release')
    if catalog['other_oldest_transaction_seconds'] > 30:
        raise RuntimeError('Database has a transaction older than 30 seconds; review before release')
    if any(index['name']=='ix_quotation_project_created_id' for index in catalog['quotation_indexes']):
        raise RuntimeError('Candidate quotation index already exists; review changed state')
    if any(not index['valid'] or not index['ready'] for index in catalog['quotation_indexes']):
        raise RuntimeError('Quotation has an invalid or unready index; review before release')
    return result


def main(release_sha: str) -> None:
    if not SHA.fullmatch(APPROVED_RELEASE_CANDIDATE_SHA):
        raise ValueError('Release candidate must be pinned before execution')
    if not SHA.fullmatch(release_sha):
        raise ValueError('Expected a full lowercase commit SHA')
    os.umask(0o077)
    if os.geteuid() != 0:
        raise RuntimeError('Expected existing root deployment identity; do not escalate or change permissions')
    postgres = container('freelance-ops-v2-infra', 'postgres')
    backend = container(PROJECT, 'backend')
    agent = container(PROJECT, 'agent')
    images = {}
    backend_env = {}
    for service, cid in [('backend', backend), ('agent', agent)]:
        data = json.loads(command(['docker', 'inspect', cid]))[0]
        image = json.loads(command(['docker', 'image', 'inspect', data['Image']]))[0]
        if not DIGEST.fullmatch(image['Id']):
            raise RuntimeError(f'{service} image ID is invalid')
        tag = data['Config']['Image']
        if not re.fullmatch(r'ghcr.io/[a-z0-9_-]+/freelance-ops-' + service + r':'+service+r'-[0-9a-f]{40}', tag):
            raise RuntimeError(f'{service} image is not pinned to an immutable commit tag')
        if tag.rsplit(':', 1)[1] != f'{service}-{EXPECTED_CURRENT_SHAS[service]}':
            raise RuntimeError(f'{service} is not the reviewed pre-release version; stop and review changed state')
        marker_path = DEPLOY_ROOT / ('.' + service + '-deployed-tag')
        marker = marker_path.read_text().strip()
        if tag.rsplit(':', 1)[1] != marker:
            raise RuntimeError(f'{service} deployed marker does not match its running image')
        images[service] = {'tag': tag, 'image_id': image['Id'],
                           'repo_digests': image.get('RepoDigests', []),
                           'healthy': data['State'].get('Health', {}).get('Status') == 'healthy'}
        if service == 'backend':
            backend_env = environment(data['Config'].get('Env', []))
    config = safe_configuration(backend_env)
    if not all(config.values()) or not all(item['healthy'] for item in images.values()):
        print(json.dumps({'images': images, 'configuration_checks': config}, sort_keys=True))
        raise RuntimeError('Production health or safety configuration is not ready')
    psql = ['docker', 'exec', postgres, 'psql', '-X', '-qAt', '--username', 'postgres',
            '--dbname', 'freelance_ops', '--set', 'ON_ERROR_STOP=1', '--command']
    schema = command(psql + ["SELECT COALESCE(MAX(version::int),0) FROM app.flyway_schema_history WHERE success AND version ~ '^[0-9]+$'"])
    if schema != '47':
        raise RuntimeError('Expected pre-release Flyway schema 47; stop and review changed state')
    alembic = command(psql + ['SELECT version_num FROM agent_runtime.alembic_version'])
    if alembic != '20260912_0007':
        raise RuntimeError('Expected pre-release Alembic 20260912_0007; stop and review changed state')
    observation = migration_preflight(postgres)
    db_size = int(command(psql + ["SELECT pg_database_size('freelance_ops')"]))
    if db_size > 4 * 1024**3:
        raise RuntimeError('Database exceeds bounded 4 GiB snapshot window; review backup separately')
    BACKUP_ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
    root_stat = BACKUP_ROOT.stat()
    print(json.dumps({'backup_root_checks': {'mode': oct(stat.S_IMODE(root_stat.st_mode)),
        'owner_is_root': root_stat.st_uid == 0, 'is_symlink': BACKUP_ROOT.is_symlink()}}, sort_keys=True), flush=True)
    if BACKUP_ROOT.is_symlink() or root_stat.st_uid != 0 or stat.S_IMODE(root_stat.st_mode) & 0o022:
        raise RuntimeError('Existing backup root must be root-owned and not group/world writable')
    # Existing shared backup root may be 0755. Each new snapshot itself remains
    # 0700, with 0600 files; no existing permissions are changed.
    if shutil.disk_usage(BACKUP_ROOT).free < db_size + 1024**3:
        raise RuntimeError('Insufficient free storage for bounded local snapshot')
    timestamp = dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    snapshot = BACKUP_ROOT / f'release_{timestamp}_{release_sha[:12]}'
    snapshot.mkdir(mode=0o700, exist_ok=False)
    dump = snapshot / 'freelance_ops.dump'
    with dump.open('xb') as stream:
        command(['docker', 'exec', postgres, 'pg_dump', '--username', 'postgres',
                 '--dbname', 'freelance_ops', '--format', 'custom', '--lock-wait-timeout=10s'],
                output_file=stream, timeout=600)
    if stat.S_IMODE(snapshot.stat().st_mode) != 0o700 or stat.S_IMODE(dump.stat().st_mode) != 0o600:
        raise RuntimeError('Snapshot permissions failed verification')
    if dump.stat().st_size == 0:
        raise RuntimeError('Snapshot is empty')
    with dump.open('rb') as stream, (snapshot / 'archive.catalog').open('xb') as catalog:
        command(['docker', 'exec', '-i', postgres, 'pg_restore', '--list'],
                input_file=stream, output_file=catalog, timeout=60)
    with dump.open('rb') as stream:
        command(['docker', 'exec', '-i', postgres, 'pg_restore', '--exit-on-error', '--file=/dev/null'],
                input_file=stream, timeout=600)
    checksum = sha256(dump)
    (snapshot / 'freelance_ops.dump.sha256').write_text(checksum + '  freelance_ops.dump\n')
    if sha256(dump) != checksum:
        raise RuntimeError('Snapshot integrity verification failed')
    result = {'snapshot_path': str(dump), 'snapshot_sha256': checksum,
              'snapshot_bytes': dump.stat().st_size, 'created_at_utc': timestamp,
              'release_preflight_sha': release_sha,
              'approved_release_candidate_sha': APPROVED_RELEASE_CANDIDATE_SHA,
              'observation': observation,
              'snapshot_directory_mode': '0700', 'snapshot_file_mode': '0600',
              'database_size_bytes': db_size,
              'flyway_version': int(schema),
              'alembic_version': alembic, 'images': images, 'configuration_checks': config,
              'archive_catalog_verified': True, 'archive_fully_decoded': True,
              'restore_drill_performed': False, 'off_host_backup_verified': False,
              'off_host_destination_configured': env_key_present(DEPLOY_ROOT / '.env', 'BACKUP_REMOTE'),
              'production_changed': False, 'deployment_authorized_by_preflight': False}
    (snapshot / 'release-metadata.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == '__main__':
    try:
        if len(sys.argv) != 2:
            raise ValueError('Usage: production-preflight.py <full-commit-sha>')
        main(sys.argv[1])
    except Exception as exc:
        # Exceptions above carry no secret-bearing subprocess output.
        detail = str(exc) if type(exc) in (RuntimeError, ValueError) else 'Unexpected operation failure'
        print(f'Preflight stopped: {type(exc).__name__}: {detail}', file=sys.stderr)
        sys.exit(1)

