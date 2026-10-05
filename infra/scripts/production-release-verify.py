#!/usr/bin/env python3
"""Read-only post-release health, immutable image and schema verification.

Never deploys, changes configuration, writes or restores database data, creates
credentials, or sends production data off-host. Only allowlisted metadata is printed.
"""
from __future__ import annotations

import json
from pathlib import Path
import re
import subprocess
import sys

DEPLOY_ROOT = Path('/opt/freelance-ops')
PROJECT = 'freelance-ops-v2-production'
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


def main(expected_backend_sha: str, expected_schema: str, expected_agent_sha: str) -> None:
    if not SHA.fullmatch(expected_backend_sha) or not SHA.fullmatch(expected_agent_sha):
        raise ValueError('Expected full image commit SHAs')
    if expected_schema not in ('35', '46'):
        raise ValueError('Expected reviewed schema 35 or 46')
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
            config = safe_configuration(environment(data['Config'].get('Env', [])))
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
    aggregate_queries = {"app-active-readonly.sql":"-- Reviewed against app schema V35 (bb20df8). Aggregate-only; do not return payloads or identifiers.\nBEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;\nSET LOCAL statement_timeout = '5s';\nSET LOCAL lock_timeout = '1s';\n\n-- Public projection: a fixed row for each active status, including zero counts.\nSELECT expected.status,\n       count(r.id) AS run_count,\n       count(r.id) FILTER (WHERE r.credential_id IS NOT NULL) AS byok_run_count,\n       count(r.id) FILTER (WHERE r.credential_id IS NULL) AS platform_run_count\nFROM (VALUES ('QUEUED'), ('RUNNING'), ('WAITING_FOR_USER')) AS expected(status)\nLEFT JOIN app.agent_run r ON r.status = expected.status\nGROUP BY expected.status ORDER BY expected.status;\n\n-- Undelivered commands are a separate boundary: queued legacy commands can fail after rollout.\nWITH pending AS (\n    SELECT command_type, status, available_at, lease_until,\n           CASE WHEN payload IS JSON OBJECT THEN payload::jsonb ELSE NULL END AS body\n    FROM app.agent_run_command WHERE status IN ('PENDING', 'PROCESSING')\n)\nSELECT command_type, status, count(*) AS command_count,\n       count(*) FILTER (WHERE status = 'PENDING' AND available_at <= now()) AS ready_count,\n       count(*) FILTER (WHERE status = 'PROCESSING' AND lease_until <= now()) AS expired_lease_count,\n       count(*) FILTER (WHERE command_type = 'START' AND body IS NULL) AS invalid_start_json_count,\n       count(*) FILTER (WHERE command_type = 'START' AND body IS NOT NULL\n           AND NOT coalesce(jsonb_typeof(coalesce(nullif(body->'platformBudget', 'null'::jsonb),\n                                                body->'platform_budget')) = 'object', false)) AS legacy_start_without_budget_count,\n       count(*) FILTER (WHERE command_type = 'START'\n           AND coalesce(body#>>'{modelSelection,credentialId}',\n                        body#>>'{model_selection,credential_id}') IS NOT NULL) AS byok_start_count\nFROM pending GROUP BY command_type, status ORDER BY command_type, status;\nCOMMIT;\n","agent-active-readonly.sql":"-- Reviewed against agent runtime 20260912_0007. No prompt, UUID, credential, or blob output.\nBEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;\nSET LOCAL statement_timeout = '5s';\nSET LOCAL lock_timeout = '1s';\n\nWITH active AS (\n    SELECT run_id, status,\n           coalesce(request_json#>>'{model_selection,credential_id}',\n                    request_json#>>'{modelSelection,credentialId}') IS NOT NULL AS byok,\n           coalesce(jsonb_typeof(coalesce(nullif(request_json->'platform_budget', 'null'::jsonb),\n                                          request_json->'platformBudget')) = 'object', false) AS has_budget,\n           interruption_json IS NOT NULL AND interruption_json <> 'null'::jsonb AS has_interruption\n    FROM agent_runtime.agent_run_state WHERE status IN ('QUEUED', 'RUNNING', 'WAITING_FOR_USER')\n)\nSELECT expected.status, count(a.run_id) AS run_count,\n       count(a.run_id) FILTER (WHERE a.byok) AS byok_run_count,\n       count(a.run_id) FILTER (WHERE NOT a.byok) AS platform_run_count,\n       count(a.run_id) FILTER (WHERE NOT a.has_budget) AS legacy_without_budget_count,\n       count(a.run_id) FILTER (WHERE NOT a.has_budget AND a.byok) AS legacy_byok_without_budget_count,\n       count(a.run_id) FILTER (WHERE a.has_interruption) AS with_interruption_count\nFROM (VALUES ('QUEUED'), ('RUNNING'), ('WAITING_FOR_USER')) AS expected(status)\nLEFT JOIN active a ON a.status = expected.status\nGROUP BY expected.status ORDER BY expected.status;\n\n-- Unfinished async work can remain even if the top-level run projection is terminal.\nSELECT status, count(*) AS task_count\nFROM agent_runtime.agent_task\nWHERE status IN ('SUBMITTED', 'ADMITTED', 'DEFERRED', 'QUEUED', 'RUNNING', 'CHECKPOINTED',\n                 'PAUSED', 'RETRY_WAIT', 'WAITING_FOR_CAPACITY')\nGROUP BY status ORDER BY status;\n\nSELECT status, count(*) AS attempt_count,\n       count(*) FILTER (WHERE checkpoint_id IS NOT NULL) AS with_checkpoint_count\nFROM agent_runtime.agent_task_attempt\nWHERE status IN ('PREDICTED', 'QUEUED', 'RUNNING', 'CHECKPOINTED')\nGROUP BY status ORDER BY status;\n\nSELECT entry_status, queue_kind, count(*) AS scheduler_entry_count,\n       count(*) FILTER (WHERE entry_status = 'CLAIMED' AND lease_until <= now()) AS expired_lease_count\nFROM agent_runtime.agent_scheduler_entry WHERE entry_status IN ('PENDING', 'CLAIMED')\nGROUP BY entry_status, queue_kind ORDER BY entry_status, queue_kind;\n\n-- LangGraph tables are separately maintained by AsyncPostgresSaver, not Alembic revision 0007.\nSELECT to_regclass('agent_runtime.checkpoints') IS NOT NULL AS checkpoints_table_present,\n       to_regclass('agent_runtime.checkpoint_writes') IS NOT NULL AS checkpoint_writes_table_present;\nCOMMIT;\n","cross-schema-boundary-readonly.sql":"-- Optional: only an already-authorized read-only role that can read BOTH schemas.\n-- Do not broaden permissions solely for this query. No identifiers are returned.\nBEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;\nSET LOCAL statement_timeout = '5s';\nSET LOCAL lock_timeout = '1s';\nSELECT coalesce(a.status, 'MISSING') AS app_status,\n       coalesce(r.status, 'MISSING') AS runtime_status, count(*) AS run_count\nFROM app.agent_run a FULL JOIN agent_runtime.agent_run_state r ON r.run_id = a.id\nWHERE a.status IN ('QUEUED', 'RUNNING', 'WAITING_FOR_USER')\n   OR r.status IN ('QUEUED', 'RUNNING', 'WAITING_FOR_USER')\nGROUP BY coalesce(a.status, 'MISSING'), coalesce(r.status, 'MISSING')\nORDER BY app_status, runtime_status;\nCOMMIT;\n"}
    aggregate_results = {name: command(aggregate_psql + [query], timeout=20)
                         for name, query in aggregate_queries.items()}
    print(json.dumps({'active_work_aggregate_counts': aggregate_results},
                     indent=2, sort_keys=True))

    print(json.dumps({'images': images, 'configuration_checks': config,
                      'flyway_version': int(schema), 'failed_migrations': int(failed),
                      'alembic_version': alembic, 'backend_readiness': 'UP',
                      'read_only_verification': True}, indent=2, sort_keys=True))


if __name__ == '__main__':
    try:
        if len(sys.argv) != 4:
            raise ValueError('Usage: production-release-verify.py <backend-sha> <schema> <agent-sha>')
        main(*sys.argv[1:])
    except Exception as exc:
        print(f'Verification stopped: {type(exc).__name__}: {exc}', file=sys.stderr)
        sys.exit(1)
