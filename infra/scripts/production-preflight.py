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

DEPLOY_ROOT = Path('/opt/freelance-ops')
BACKUP_ROOT = Path('/var/backups/freelance-ops')
PROJECT = 'freelance-ops-v2-production'
EXPECTED_CURRENT_SHAS = {
    'backend': '988d7581e857ec74c0415a269939a9681d8c920a',
    'agent': '00ba39b14fe6fd05aea9b011514bb70d17cbf79e',
}
APPROVED_RELEASE_CANDIDATE_SHA = 'dc39937aa9f118e012e6de4f33d3208dcd813921'
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


def main(release_sha: str) -> None:
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
    db_size = int(command(psql + ["SELECT pg_database_size('freelance_ops')"]))
    if db_size > 4 * 1024**3:
        raise RuntimeError('Database exceeds bounded 4 GiB snapshot window; review backup separately')
    BACKUP_ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
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
        print(f'Preflight stopped: {type(exc).__name__}: {exc}', file=sys.stderr)
        sys.exit(1)
