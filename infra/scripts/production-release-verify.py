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
