import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts' / 'production-readiness-snapshot.py'
spec = importlib.util.spec_from_file_location('readiness', SCRIPT)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def observation():
    db = {name: 0 for name in m.DB_KEYS}
    db.update(max_connections=100, connections_total=18, schema_version=48,
              postgres_version_num=170011, database_size_bytes=10000000,
              runtime_waiting_runs=1, runtime_orphan_waiting_runs=1)
    return {'images': {service: {
        'tag': f'ghcr.io/jomkeu3369/freelance-ops-{service}:{service}-{sha}',
        'health': 'healthy', 'state': 'running', 'marker_matches': True,
        'oom_killed': False} for service, sha in m.EXPECTED.items()},
        'database': db, 'resources': {'cpu_percent': 2, 'cpu_count': 1, 'load1': .1,
            'memory_available_percent': 40, 'memory_available_mib': 800,
            'disk_free_percent': 40, 'disk_free_gib': 10},
        'alembic_version': '20260912_0007'}


class ProductionReadinessSafetyTest(unittest.TestCase):
    def test_reviewed_metadata_allows_snapshot_with_preserved_orphan_waiting(self):
        data = observation()
        before = copy.deepcopy(data)
        m.snapshot_safety(data)
        self.assertEqual(before, data)

    def test_any_active_execution_or_unfinished_work_refuses_backup(self):
        for field in ('app_active_runs', 'app_pending_commands', 'runtime_active_runs',
                      'unfinished_tasks', 'unfinished_attempts', 'pending_scheduler_entries'):
            with self.subTest(field=field):
                data = observation()
                data['database'][field] = 1
                with self.assertRaisesRegex(RuntimeError, field):
                    m.snapshot_safety(data)

    def test_database_pressure_refuses_backup(self):
        for field in ('waiting_locks', 'idle_in_transaction', 'prepared_transactions'):
            with self.subTest(field=field):
                data = observation()
                data['database'][field] = 1
                with self.assertRaisesRegex(RuntimeError, field):
                    m.snapshot_safety(data)

    def test_changed_image_marker_health_and_oom_refuse_backup(self):
        changes = [('tag', 'ghcr.io/jomkeu3369/freelance-ops-backend:backend-' + 'a'*40),
                   ('marker_matches', False), ('health', 'unhealthy'),
                   ('state', 'restarting'), ('oom_killed', True)]
        for field, value in changes:
            with self.subTest(field=field):
                data = observation()
                data['images']['backend'][field] = value
                with self.assertRaises(RuntimeError):
                    m.snapshot_safety(data)

    def test_changed_schema_and_failed_migration_refuse_backup(self):
        for field, value in [('schema_version', 52), ('failed_migrations', 1)]:
            with self.subTest(field=field):
                data = observation()
                data['database'][field] = value
                with self.assertRaisesRegex(RuntimeError, 'schema48'):
                    m.snapshot_safety(data)

    def test_resource_boundaries_refuse_backup(self):
        for field, value in [('cpu_percent', 85), ('load1', 2),
                             ('memory_available_percent', 14.9), ('memory_available_mib', 127),
                             ('disk_free_percent', 9.9), ('disk_free_gib', .9)]:
            with self.subTest(field=field):
                data = observation()
                data['resources'][field] = value
                with self.assertRaises(RuntimeError):
                    m.snapshot_safety(data)

    def test_connection_and_archive_size_bounds(self):
        for field, value in [('connections_total', 80), ('database_size_bytes', 4*1024**3+1)]:
            with self.subTest(field=field):
                data = observation()
                data['database'][field] = value
                with self.assertRaises(RuntimeError):
                    m.snapshot_safety(data)

    def test_arbitrary_subprocess_stderr_is_never_exposed(self):
        result = subprocess.CompletedProcess(['docker'], 1, b'', b'private-token-fixture')
        with patch.object(m.subprocess, 'run', return_value=result):
            with self.assertRaisesRegex(RuntimeError, '^docker_failed_exit_1$') as caught:
                m.command(['docker', 'exec'])
        self.assertNotIn('private-token-fixture', str(caught.exception))

    def test_unknown_boolean_or_text_database_fields_are_rejected_before_output(self):
        for field, value in [('unexpected_secret', 'fixture'), ('app_active_runs', True),
                             ('app_pending_commands', -1)]:
            with self.subTest(field=field):
                data = observation()['database']
                data[field] = value
                with patch.object(m, 'psql', return_value=json.dumps(data)):
                    with self.assertRaisesRegex(RuntimeError, 'shape_invalid'):
                        m.db_metadata('synthetic')

    def test_production_procedure_contains_no_configuration_or_secret_reads(self):
        source = SCRIPT.read_text()
        self.assertNotIn("['docker', 'inspect', cid]", source)
        self.assertNotIn('.Config.Env', m.CONTAINER_FORMAT)
        self.assertNotIn("DEPLOY_ROOT / '.env'", source)
        for forbidden in ('ensure-byok-key', 'docker compose', 'rclone', 'CREATE ROLE',
                          'ALTER ROLE', 'pg_restore --dbname', 'DROP DATABASE'):
            self.assertNotIn(forbidden, source)


if __name__ == '__main__':
    unittest.main()
