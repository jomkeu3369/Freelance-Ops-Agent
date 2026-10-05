#!/usr/bin/env python3
"""Read-only pre/post-release health, immutable image, schema and inventory verification.

Never deploys, changes configuration, writes or restores database data, creates
credentials, or sends production data off-host. Only allowlisted metadata is printed.
"""
from __future__ import annotations

import json
import hmac
from pathlib import Path
import re
import subprocess
import sys

DEPLOY_ROOT = Path('/opt/freelance-ops')
PROJECT = 'freelance-ops-v2-production'
SHA = re.compile(r'[0-9a-f]{40}')
DIGEST = re.compile(r'sha256:[0-9a-f]{64}')
PREDEPLOY_BACKEND_SHA = '98efb8b0bd4576cccab8c69217f450a4da88ad9b'
PREDEPLOY_AGENT_SHA = 'bb20df86836ce8787095677180bb0a885a897a9a'

# Exact aggregate boundary reviewed before the schema 35 -> 47 server stage.
# One inaccessible legacy runtime interruption is preserved, not failed or deleted.
EXPECTED_PREDEPLOY_INVENTORY = {
    "app_active": 0,
    "app_pending_commands": 0,
    "runtime_queued": 0,
    "runtime_running": 0,
    "runtime_waiting": 1,
    "runtime_legacy_platform_waiting_with_interruption": 1,
    "runtime_scoped_byok_active": 0,
    "runtime_conflicting_funding_active": 0,
    "runtime_missing_app_active": 1,
    "app_missing_runtime_active": 0,
    "unfinished_tasks": 0,
    "unfinished_attempts": 0,
    "pending_scheduler_entries": 0,
    "checkpoints_table_present": True,
    "checkpoint_writes_table_present": True,
}

INVENTORY_QUERY = """
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '1s';
WITH active_runtime AS (
    SELECT run_id, status,
           coalesce(request_json#>>'{model_selection,credential_id}',
                    request_json#>>'{modelSelection,credentialId}') IS NOT NULL AS byok,
           coalesce(jsonb_typeof(coalesce(nullif(request_json->'platform_budget', 'null'::jsonb),
                                          request_json->'platformBudget')) = 'object', false) AS has_platform_budget,
           coalesce(jsonb_typeof(coalesce(nullif(request_json->'byok_budget', 'null'::jsonb),
                                          request_json->'byokBudget')) = 'object', false) AS has_byok_budget,
           interruption_json IS NOT NULL AND interruption_json <> 'null'::jsonb AS has_interruption
    FROM agent_runtime.agent_run_state WHERE status IN ('QUEUED', 'RUNNING', 'WAITING_FOR_USER')
)
SELECT json_build_object(
    'app_active', (SELECT count(*) FROM app.agent_run WHERE status IN ('QUEUED','RUNNING','WAITING_FOR_USER')),
    'app_pending_commands', (SELECT count(*) FROM app.agent_run_command WHERE status IN ('PENDING','PROCESSING')),
    'runtime_queued', (SELECT count(*) FROM active_runtime WHERE status='QUEUED'),
    'runtime_running', (SELECT count(*) FROM active_runtime WHERE status='RUNNING'),
    'runtime_waiting', (SELECT count(*) FROM active_runtime WHERE status='WAITING_FOR_USER'),
    'runtime_legacy_platform_waiting_with_interruption',
        (SELECT count(*) FROM active_runtime WHERE status='WAITING_FOR_USER' AND NOT byok
         AND NOT has_platform_budget AND NOT has_byok_budget AND has_interruption),
    'runtime_scoped_byok_active', (SELECT count(*) FROM active_runtime WHERE has_byok_budget),
    'runtime_conflicting_funding_active',
        (SELECT count(*) FROM active_runtime WHERE has_platform_budget AND has_byok_budget),
    'runtime_missing_app_active', (SELECT count(*) FROM active_runtime r
                                   WHERE NOT EXISTS (SELECT 1 FROM app.agent_run a WHERE a.id=r.run_id)),
    'app_missing_runtime_active', (SELECT count(*) FROM app.agent_run a
        WHERE a.status IN ('QUEUED','RUNNING','WAITING_FOR_USER')
          AND NOT EXISTS (SELECT 1 FROM agent_runtime.agent_run_state r WHERE r.run_id=a.id)),
    'unfinished_tasks', (SELECT count(*) FROM agent_runtime.agent_task
        WHERE status IN ('SUBMITTED','ADMITTED','DEFERRED','QUEUED','RUNNING','CHECKPOINTED',
                         'PAUSED','RETRY_WAIT','WAITING_FOR_CAPACITY')),
    'unfinished_attempts', (SELECT count(*) FROM agent_runtime.agent_task_attempt
        WHERE status IN ('PREDICTED','QUEUED','RUNNING','CHECKPOINTED')),
    'pending_scheduler_entries', (SELECT count(*) FROM agent_runtime.agent_scheduler_entry
        WHERE entry_status IN ('PENDING','CLAIMED')),
    'checkpoints_table_present', to_regclass('agent_runtime.checkpoints') IS NOT NULL,
    'checkpoint_writes_table_present', to_regclass('agent_runtime.checkpoint_writes') IS NOT NULL
);
COMMIT;
"""


def validate_inventory_shape(inventory: object) -> None:
    if not isinstance(inventory, dict) or set(inventory) != set(EXPECTED_PREDEPLOY_INVENTORY):
        raise RuntimeError('Unexpected aggregate inventory shape')
    for key, expected in EXPECTED_PREDEPLOY_INVENTORY.items():
        actual = inventory[key]
        if type(actual) is not type(expected) or isinstance(actual, int) and not isinstance(actual, bool) and actual < 0:
            raise RuntimeError('Unexpected aggregate inventory value type')


def validate_inventory(inventory: object, mode: str) -> None:
    validate_inventory_shape(inventory)
    if mode == 'predeploy' and inventory != EXPECTED_PREDEPLOY_INVENTORY:
        # Values are printed as aggregate-only evidence by main; never echo raw rows.
        changed = sorted(key for key, expected in EXPECTED_PREDEPLOY_INVENTORY.items() if inventory[key] != expected)
        raise RuntimeError('Predeploy inventory changed; review required: ' + ', '.join(changed))
    if not inventory['checkpoints_table_present'] or not inventory['checkpoint_writes_table_present']:
        raise RuntimeError('Required checkpoint tables are missing')
    if inventory['runtime_conflicting_funding_active'] != 0:
        raise RuntimeError('An active runtime request has conflicting platform and BYOK funding')


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



def persisted_byok_key_checks(path: Path, running_key: str) -> dict[str, bool]:
    """Check the exact ensure-byok-key.sh format without exposing secret material."""
    checks = {
        'persisted_byok_key_readable': False,
        'persisted_byok_key_present': False,
        'persisted_byok_key_unique': False,
        'persisted_byok_key_valid': False,
        'persisted_byok_key_matches_running': False,
    }
    values = []
    try:
        # Split only on LF, like grep/sed; preserve CR/whitespace in each value.
        # Only retain matching key lines; never return .env content or fingerprints.
        with path.open('r', encoding='utf-8', newline='\n') as stream:
            for line in stream:
                if line.startswith('APP_BYOK_ENCRYPTION_KEY='):
                    values.append(line.removesuffix('\n').split('=', 1)[1])
    except (OSError, UnicodeError):
        return checks
    checks['persisted_byok_key_readable'] = True
    checks['persisted_byok_key_present'] = bool(values) and any(bool(value) for value in values)
    checks['persisted_byok_key_unique'] = len(values) == 1
    valid = len(values) == 1 and re.fullmatch(r'[A-Za-z0-9+/]{43}=', values[0]) is not None
    checks['persisted_byok_key_valid'] = valid
    checks['persisted_byok_key_matches_running'] = valid and hmac.compare_digest(
        values[0].encode('utf-8'), running_key.encode('utf-8'))
    return checks


def validate_expected_release(expected_backend_sha: str, expected_schema: str, expected_agent_sha: str, mode: str) -> None:
    if not SHA.fullmatch(expected_backend_sha) or not SHA.fullmatch(expected_agent_sha):
        raise ValueError('Expected full image commit SHAs')
    if expected_schema not in ('35', '46', '47'):
        raise ValueError('Expected reviewed schema 35, 46 or 47')
    if mode not in ('predeploy', 'postdeploy'):
        raise ValueError('Expected explicit predeploy or postdeploy mode')
    if mode == 'predeploy' and expected_schema != '35':
        raise ValueError('Reviewed predeploy inventory applies only to schema 35')
    if mode == 'predeploy' and (expected_backend_sha != PREDEPLOY_BACKEND_SHA
                                or expected_agent_sha != PREDEPLOY_AGENT_SHA):
        raise ValueError('Predeploy requires the reviewed backend and agent baseline pins')


def main(expected_backend_sha: str, expected_schema: str, expected_agent_sha: str, mode: str = "postdeploy") -> None:
    validate_expected_release(expected_backend_sha, expected_schema, expected_agent_sha, mode)
    postgres = container('freelance-ops-v2-infra', 'postgres')
    images = {}
    config = {}
    for service, expected_sha in [('backend', expected_backend_sha), ('agent', expected_agent_sha)]:
        cid = container(PROJECT, service)
        data = json.loads(command(['docker', 'inspect', cid]))[0]
        image = json.loads(command(['docker', 'image', 'inspect', data['Image']]))[0]
        tag = data['Config']['Image']
        if not tag.endswith(':' + service + '-' + expected_sha):
            raise RuntimeError(f'{service} does not match the expected release')
        if not DIGEST.fullmatch(image['Id']):
            raise RuntimeError(f'{service} immutable image ID is invalid')
        marker = (DEPLOY_ROOT / ('.' + service + '-deployed-tag')).read_text().strip()
        if marker != service + '-' + expected_sha:
            raise RuntimeError(f'{service} marker does not match the expected release')
        healthy = data['State'].get('Health', {}).get('Status') == 'healthy'
        if not healthy:
            raise RuntimeError(f'{service} is not healthy')
        images[service] = {'tag': tag, 'image_id': image['Id'], 'healthy': healthy}
        if service == 'backend':
            backend_env = environment(data['Config'].get('Env', []))
            config = safe_configuration(backend_env)
            config.update(persisted_byok_key_checks(DEPLOY_ROOT / '.env',
                                                  backend_env.get('APP_BYOK_ENCRYPTION_KEY', '')))
    if not all(config.values()):
        print(json.dumps({'configuration_checks': config}, sort_keys=True))
        raise RuntimeError('Safety configuration failed')
    psql = ['docker', 'exec', postgres, 'psql', '-X', '-qAt', '--username', 'postgres',
            '--dbname', 'freelance_ops', '--set', 'ON_ERROR_STOP=1', '--command']
    schema = command(psql + ["SELECT COALESCE(MAX(version::int),0) FROM app.flyway_schema_history WHERE success AND version ~ '^[0-9]+$'"])
    if schema != expected_schema:
        raise RuntimeError('Unexpected Flyway version')
    failed = command(psql + ['SELECT COUNT(*) FROM app.flyway_schema_history WHERE NOT success'])
    if failed != '0':
        raise RuntimeError('Failed Flyway migration exists')
    alembic = command(psql + ['SELECT version_num FROM agent_runtime.alembic_version'])
    if alembic != '20260912_0007':
        raise RuntimeError('Unexpected Alembic version')
    readiness = json.loads(command(['curl', '--fail', '--silent', '--show-error', '--max-time', '5',
                                   'http://127.0.0.1:8080/actuator/health/readiness']))
    if readiness.get('status') != 'UP':
        raise RuntimeError('Backend readiness is not UP')

    aggregate_psql = ['docker', 'exec', postgres, 'psql', '-X', '-q', '--csv',
                      '--username', 'postgres', '--dbname', 'freelance_ops',
                      '--set', 'ON_ERROR_STOP=1', '--command']
    aggregate_queries = {
        'app-active-readonly.sql': """-- Shared schema 35/46/47 read-only columns; return aggregates only.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '1s';

-- Public projection: a fixed row for each active status, including zero counts.
SELECT expected.status,
       count(r.id) AS run_count,
       count(r.id) FILTER (WHERE r.credential_id IS NOT NULL) AS byok_run_count,
       count(r.id) FILTER (WHERE r.credential_id IS NULL) AS platform_run_count
FROM (VALUES ('QUEUED'), ('RUNNING'), ('WAITING_FOR_USER')) AS expected(status)
LEFT JOIN app.agent_run r ON r.status = expected.status
GROUP BY expected.status ORDER BY expected.status;

-- Undelivered commands are a separate boundary: queued legacy commands can fail after rollout.
WITH pending AS (
    SELECT command_type, status, available_at, lease_until,
           CASE WHEN payload IS JSON OBJECT THEN payload::jsonb ELSE NULL END AS body
    FROM app.agent_run_command WHERE status IN ('PENDING', 'PROCESSING')
)
SELECT command_type, status, count(*) AS command_count,
       count(*) FILTER (WHERE status = 'PENDING' AND available_at <= now()) AS ready_count,
       count(*) FILTER (WHERE status = 'PROCESSING' AND lease_until <= now()) AS expired_lease_count,
       count(*) FILTER (WHERE command_type = 'START' AND body IS NULL) AS invalid_start_json_count,
       count(*) FILTER (WHERE command_type = 'START' AND body IS NOT NULL
           AND NOT coalesce(jsonb_typeof(coalesce(nullif(body->'platformBudget', 'null'::jsonb),
                                                body->'platform_budget')) = 'object', false)
           AND NOT coalesce(jsonb_typeof(coalesce(nullif(body->'byokBudget', 'null'::jsonb),
                                                body->'byok_budget')) = 'object', false)) AS legacy_start_without_budget_count,
       count(*) FILTER (WHERE command_type = 'START'
           AND coalesce(jsonb_typeof(coalesce(nullif(body->'byokBudget', 'null'::jsonb),
                                             body->'byok_budget')) = 'object', false)) AS scoped_byok_start_count,
       count(*) FILTER (WHERE command_type = 'START'
           AND coalesce(body#>>'{modelSelection,credentialId}',
                        body#>>'{model_selection,credential_id}') IS NOT NULL) AS byok_start_count
FROM pending GROUP BY command_type, status ORDER BY command_type, status;
COMMIT;
""",
        'agent-active-readonly.sql': """-- Reviewed against agent runtime 20260912_0007. No prompt, UUID, credential, or blob output.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '1s';

WITH active AS (
    SELECT run_id, status,
           coalesce(request_json#>>'{model_selection,credential_id}',
                    request_json#>>'{modelSelection,credentialId}') IS NOT NULL AS byok,
           coalesce(jsonb_typeof(coalesce(nullif(request_json->'platform_budget', 'null'::jsonb),
                                          request_json->'platformBudget')) = 'object', false) AS has_platform_budget,
           coalesce(jsonb_typeof(coalesce(nullif(request_json->'byok_budget', 'null'::jsonb),
                                          request_json->'byokBudget')) = 'object', false) AS has_byok_budget,
           interruption_json IS NOT NULL AND interruption_json <> 'null'::jsonb AS has_interruption
    FROM agent_runtime.agent_run_state WHERE status IN ('QUEUED', 'RUNNING', 'WAITING_FOR_USER')
)
SELECT expected.status, count(a.run_id) AS run_count,
       count(a.run_id) FILTER (WHERE a.byok) AS byok_run_count,
       count(a.run_id) FILTER (WHERE NOT a.byok) AS platform_run_count,
       count(a.run_id) FILTER (WHERE NOT a.has_platform_budget AND NOT a.has_byok_budget) AS legacy_without_budget_count,
       count(a.run_id) FILTER (WHERE NOT a.has_platform_budget AND NOT a.has_byok_budget AND a.byok) AS legacy_byok_without_budget_count,
       count(a.run_id) FILTER (WHERE a.has_byok_budget) AS scoped_byok_run_count,
       count(a.run_id) FILTER (WHERE a.has_platform_budget) AS scoped_platform_run_count,
       count(a.run_id) FILTER (WHERE a.has_platform_budget AND a.has_byok_budget) AS conflicting_funding_count,
       count(a.run_id) FILTER (WHERE a.has_interruption) AS with_interruption_count
FROM (VALUES ('QUEUED'), ('RUNNING'), ('WAITING_FOR_USER')) AS expected(status)
LEFT JOIN active a ON a.status = expected.status
GROUP BY expected.status ORDER BY expected.status;

-- Unfinished async work can remain even if the top-level run projection is terminal.
SELECT status, count(*) AS task_count
FROM agent_runtime.agent_task
WHERE status IN ('SUBMITTED', 'ADMITTED', 'DEFERRED', 'QUEUED', 'RUNNING', 'CHECKPOINTED',
                 'PAUSED', 'RETRY_WAIT', 'WAITING_FOR_CAPACITY')
GROUP BY status ORDER BY status;

SELECT status, count(*) AS attempt_count,
       count(*) FILTER (WHERE checkpoint_id IS NOT NULL) AS with_checkpoint_count
FROM agent_runtime.agent_task_attempt
WHERE status IN ('PREDICTED', 'QUEUED', 'RUNNING', 'CHECKPOINTED')
GROUP BY status ORDER BY status;

SELECT entry_status, queue_kind, count(*) AS scheduler_entry_count,
       count(*) FILTER (WHERE entry_status = 'CLAIMED' AND lease_until <= now()) AS expired_lease_count
FROM agent_runtime.agent_scheduler_entry WHERE entry_status IN ('PENDING', 'CLAIMED')
GROUP BY entry_status, queue_kind ORDER BY entry_status, queue_kind;

-- LangGraph tables are separately maintained by AsyncPostgresSaver, not Alembic revision 0007.
SELECT to_regclass('agent_runtime.checkpoints') IS NOT NULL AS checkpoints_table_present,
       to_regclass('agent_runtime.checkpoint_writes') IS NOT NULL AS checkpoint_writes_table_present;
COMMIT;
""",
        'cross-schema-boundary-readonly.sql': """-- Optional: only an already-authorized read-only role that can read BOTH schemas.
-- Do not broaden permissions solely for this query. No identifiers are returned.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '1s';
SELECT coalesce(a.status, 'MISSING') AS app_status,
       coalesce(r.status, 'MISSING') AS runtime_status, count(*) AS run_count
FROM app.agent_run a FULL JOIN agent_runtime.agent_run_state r ON r.run_id = a.id
WHERE a.status IN ('QUEUED', 'RUNNING', 'WAITING_FOR_USER')
   OR r.status IN ('QUEUED', 'RUNNING', 'WAITING_FOR_USER')
GROUP BY coalesce(a.status, 'MISSING'), coalesce(r.status, 'MISSING')
ORDER BY app_status, runtime_status;
COMMIT;
""",
    }
    aggregate_results = {name: command(aggregate_psql + [query], timeout=20)
                         for name, query in aggregate_queries.items()}
    print(json.dumps({'active_work_aggregate_counts': aggregate_results},
                     indent=2, sort_keys=True))

    inventory = json.loads(command(psql + [INVENTORY_QUERY], timeout=20))
    validate_inventory_shape(inventory)  # Validate allowlisted shape before printing.
    print(json.dumps({'verification_mode': mode, 'active_inventory': inventory}, indent=2, sort_keys=True))
    validate_inventory(inventory, mode)

    print(json.dumps({'images': images, 'configuration_checks': config,
                      'flyway_version': int(schema), 'failed_migrations': int(failed),
                      'alembic_version': alembic, 'backend_readiness': 'UP',
                      'verification_mode': mode,
                      'predeploy_inventory_matches_reviewed_boundary': True if mode == 'predeploy' else None,
                      'read_only_verification': True}, indent=2, sort_keys=True))


if __name__ == '__main__':
    try:
        if len(sys.argv) not in (4, 5):
            raise ValueError('Usage: production-release-verify.py <backend-sha> <schema> <agent-sha> [predeploy|postdeploy]')
        main(*sys.argv[1:])
    except Exception as exc:
        print(f'Verification stopped: {type(exc).__name__}: {exc}', file=sys.stderr)
        sys.exit(1)
