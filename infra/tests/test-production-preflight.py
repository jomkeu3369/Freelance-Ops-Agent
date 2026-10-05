import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

SPEC = importlib.util.spec_from_file_location('preflight', Path(__file__).parents[1] / 'scripts/production-preflight.py')
preflight = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(preflight)


class PreflightSafetyTest(unittest.TestCase):
    def test_configuration_checks_are_boolean_and_secret_free(self):
        env = {'APP_BYOK_ENCRYPTION_KEY': 'SECRET_MUST_NOT_LEAK',
               'APP_AUTH_JWT_SECRET': 'ANOTHER_SECRET',
               'APP_CORS_ALLOWED_ORIGINS': 'https://www.freelance-ops.site'}
        result = preflight.safe_configuration(env)
        self.assertTrue(all(result.values()))
        self.assertTrue(all(isinstance(value, bool) for value in result.values()))
        self.assertNotIn('SECRET', json.dumps(result))
        self.assertFalse(preflight.safe_configuration(dict(env, PLATFORM_AI_SPEND_ENABLED='true'))['platform_spend_disabled'])
        self.assertFalse(preflight.safe_configuration(dict(env, APP_NOTICES_DISPATCH_ENABLED='true'))['notice_dispatch_disabled'])
        self.assertFalse(preflight.safe_configuration(dict(env, SPRING_APPLICATION_JSON='{}'))['spring_application_json_absent'])

    def test_no_credential_provisioning_or_config_mutation(self):
        source = Path(preflight.__file__).read_text()
        for forbidden in ['openssl', 'ensure-byok-key', 'rclone', 'docker login', 'createdb', 'dropdb', 'GRANT ', 'CREATE EXTENSION']:
            self.assertNotIn(forbidden, source)
        self.assertNotIn("DEPLOY_ROOT / '.env').write", source)

    def test_requires_full_sha_before_any_remote_operation(self):
        with mock.patch.object(preflight, 'command') as command:
            for value in ['main', 'a' * 39, 'b' * 41, 'a' * 40 + ';echo bad']:
                with self.assertRaises(ValueError):
                    preflight.main(value)
            command.assert_not_called()

    def test_failed_command_does_not_leak_stderr(self):
        result = mock.Mock(returncode=1, stdout=b'', stderr=b'PASSWORD=TOP_SECRET')
        with mock.patch.object(preflight.subprocess, 'run', return_value=result):
            with self.assertRaisesRegex(RuntimeError, 'docker operation failed') as caught:
                preflight.command(['docker', 'inspect', 'abc'])
        self.assertNotIn('SECRET', str(caught.exception))

    def test_backup_flag_checks_only_presence(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / '.env'
            path.write_text('SECRET=hidden\nBACKUP_REMOTE=\n')
            self.assertFalse(preflight.env_key_present(path, 'BACKUP_REMOTE'))
            path.write_text('SECRET=hidden\nBACKUP_REMOTE=crypt:existing-private-location\n')
            self.assertTrue(preflight.env_key_present(path, 'BACKUP_REMOTE'))

    def test_success_only_writes_local_backup_and_metadata(self):
        release = 'a' * 40
        tag_sha = 'b' * 40
        image_id = 'sha256:' + 'c' * 64
        seen = []
        def command(args, *, input_file=None, output_file=None, timeout=30):
            seen.append(args)
            if args[1:2] == ['inspect']:
                service = args[2]
                env = ['APP_BYOK_ENCRYPTION_KEY=SECRET', 'APP_CORS_ALLOWED_ORIGINS=https://www.freelance-ops.site']
                return json.dumps([{'Image': image_id, 'Config': {'Image': f'ghcr.io/account/freelance-ops-{service}:{service}-{tag_sha}', 'Env': env}, 'State': {'Health': {'Status': 'healthy'}}}])
            if args[1:3] == ['image', 'inspect']:
                return json.dumps([{'Id': image_id, 'RepoDigests': ['ghcr.io/account/example@'+image_id]}])
            if 'psql' in args:
                query = args[-1]
                return '35' if 'flyway' in query else '007' if 'alembic' in query else '1024'
            if 'pg_dump' in args:
                output_file.write(b'FAKE_ARCHIVE')
                return ''
            if 'pg_restore' in args:
                self.assertEqual(input_file.read(), b'FAKE_ARCHIVE')
                if output_file:
                    output_file.write(b'FAKE_CATALOG')
                self.assertNotIn('--dbname', args)
                return ''
            self.fail(f'Unexpected command {args}')
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            deploy = root / 'deploy'
            deploy.mkdir()
            for service in ['backend', 'agent']:
                (deploy / f'.{service}-deployed-tag').write_text(f'{service}-{tag_sha}')
            (deploy / '.env').write_text('APP_AUTH_JWT_SECRET=SECRET\nBACKUP_REMOTE=\n')
            with mock.patch.object(preflight, 'DEPLOY_ROOT', deploy), mock.patch.object(preflight, 'BACKUP_ROOT', root / 'backups'), mock.patch.object(preflight, 'container', side_effect=lambda project, service: service), mock.patch.object(preflight, 'command', side_effect=command), mock.patch.object(preflight.os, 'geteuid', return_value=0), mock.patch('sys.stdout', new_callable=io.StringIO) as stdout:
                preflight.main(release)
                result = json.loads(stdout.getvalue())
            self.assertTrue(result['archive_fully_decoded'])
            self.assertFalse(result['off_host_backup_verified'])
            self.assertFalse(result['restore_drill_performed'])
            self.assertFalse(result['deployment_authorized_by_preflight'])
            self.assertNotIn('SECRET', json.dumps(result))
            dump = Path(result['snapshot_path'])
            self.assertEqual(dump.stat().st_mode & 0o777, 0o600)
            self.assertEqual(dump.parent.stat().st_mode & 0o777, 0o700)
            self.assertEqual((deploy / '.env').read_text(), 'APP_AUTH_JWT_SECRET=SECRET\nBACKUP_REMOTE=\n')
            self.assertEqual(preflight.sha256(dump), result['snapshot_sha256'])
        self.assertFalse(any('up' in args or 'restore-drill' in args for args in seen))


if __name__ == '__main__':
    unittest.main()
