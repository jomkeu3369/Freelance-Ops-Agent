"""Offline verifier regressions. All container/SQL/HTTP/process operations are mocked."""
from contextlib import redirect_stdout
import importlib.util
import io
import json
import re
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
PATH = ROOT / 'infra/scripts/production-release-verify.py'
spec = importlib.util.spec_from_file_location('production_release_verify', PATH)
verify = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verify)
BACKEND = verify.PREDEPLOY_BACKEND_SHA
AGENT = verify.PREDEPLOY_AGENT_SHA
TEST_KEY = 'A' * 43 + '='  # Public synthetic format fixture, never a real credential.


class FakeRoot:
    def __init__(self, env_text=None):
        self.env_text = 'APP_BYOK_ENCRYPTION_KEY=' + TEST_KEY + '\n' if env_text is None else env_text

    def __truediv__(self, marker):
        if marker == '.env':
            return SimpleNamespace(open=lambda *args, **kwargs: io.StringIO(self.env_text))
        value = ('backend-' + BACKEND) if marker == '.backend-deployed-tag' else ('agent-' + AGENT)
        return SimpleNamespace(read_text=lambda: value)


class ReleaseVerifierTest(unittest.TestCase):
    def baseline(self):
        return dict(verify.EXPECTED_PREDEPLOY_INVENTORY)

    def key_checks(self, text, running=TEST_KEY):
        path = SimpleNamespace(open=lambda *args, **kwargs: io.StringIO(text))
        return verify.persisted_byok_key_checks(path, running)

    def test_persisted_key_validity_and_match_are_booleans_only(self):
        checks = self.key_checks('OTHER=unrelated-value\nAPP_BYOK_ENCRYPTION_KEY=' + TEST_KEY + '\n')
        self.assertTrue(all(checks.values()))
        self.assertTrue(all(type(value) is bool for value in checks.values()))
        self.assertNotIn(TEST_KEY, json.dumps(checks))
        self.assertNotIn('unrelated-value', json.dumps(checks))

    def test_missing_duplicate_invalid_and_mismatched_keys_are_rejected(self):
        for text in ['', 'APP_BYOK_ENCRYPTION_KEY=\n',
                     'APP_BYOK_ENCRYPTION_KEY=' + TEST_KEY + '\nAPP_BYOK_ENCRYPTION_KEY=' + TEST_KEY + '\n',
                     'APP_BYOK_ENCRYPTION_KEY="' + TEST_KEY + '"\n',
                     'APP_BYOK_ENCRYPTION_KEY=' + TEST_KEY + ' \n',
                     'APP_BYOK_ENCRYPTION_KEY=' + TEST_KEY + '\r\n',
                     'APP_BYOK_ENCRYPTION_KEY=invalid\n',
                     'export APP_BYOK_ENCRYPTION_KEY=' + TEST_KEY + '\n']:
            with self.subTest(case='invalid-or-missing-format'):
                self.assertFalse(all(self.key_checks(text).values()))
                self.assertFalse(self.key_checks(text)['persisted_byok_key_matches_running'])
        checks = self.key_checks('APP_BYOK_ENCRYPTION_KEY=' + TEST_KEY + '\n', 'B' * 43 + '=')
        self.assertTrue(checks['persisted_byok_key_valid'])
        self.assertFalse(checks['persisted_byok_key_matches_running'])

    def test_real_text_decoder_matches_shell_lf_only_line_boundaries(self):
        for text in ['OTHER=x\rAPP_BYOK_ENCRYPTION_KEY=' + TEST_KEY + '\n',
                     'APP_BYOK_ENCRYPTION_KEY=' + TEST_KEY + '\r\n']:
            raw = text.encode('utf-8')
            path = SimpleNamespace(open=lambda *args, **kwargs: io.TextIOWrapper(
                io.BytesIO(raw), encoding=kwargs['encoding'], newline=kwargs['newline']))
            checks = verify.persisted_byok_key_checks(path, TEST_KEY)
            self.assertFalse(checks['persisted_byok_key_valid'])
            self.assertFalse(checks['persisted_byok_key_matches_running'])

    def test_unreadable_persisted_key_does_not_leak_os_error(self):
        from unittest.mock import Mock
        path = SimpleNamespace(open=Mock(side_effect=PermissionError('secret-bearing-detail')))
        checks = verify.persisted_byok_key_checks(path, TEST_KEY)
        self.assertFalse(any(checks.values()))
        self.assertNotIn('secret-bearing-detail', json.dumps(checks))

    def test_key_check_does_not_invoke_shell_helper_or_other_commands(self):
        with patch.object(verify, 'command') as command, patch.object(verify.subprocess, 'run') as run:
            self.assertTrue(all(self.key_checks('APP_BYOK_ENCRYPTION_KEY=' + TEST_KEY).values()))
            command.assert_not_called()
            run.assert_not_called()

    def test_predeploy_preserves_the_known_orphan(self):
        verify.validate_inventory(self.baseline(), 'predeploy')
        self.assertEqual(self.baseline()['runtime_waiting'], 1)
        self.assertEqual(self.baseline()['runtime_missing_app_active'], 1)

    def test_predeploy_rejects_every_changed_count_or_presence(self):
        for key, value in self.baseline().items():
            with self.subTest(key=key):
                changed = self.baseline()
                changed[key] = not value if isinstance(value, bool) else value + 1
                with self.assertRaisesRegex(RuntimeError, 'Predeploy inventory changed'):
                    verify.validate_inventory(changed, 'predeploy')

    def test_predeploy_does_not_silently_accept_disappearance_of_the_orphan(self):
        changed = self.baseline()
        changed['runtime_waiting'] = 0
        changed['runtime_missing_app_active'] = 0
        with self.assertRaisesRegex(RuntimeError, 'review required'):
            verify.validate_inventory(changed, 'predeploy')

    def test_postdeploy_does_not_reject_legitimate_scoped_activity(self):
        changed = self.baseline()
        changed.update(app_active=2, runtime_running=2, runtime_scoped_byok_active=2,
                       app_pending_commands=1, unfinished_tasks=2)
        verify.validate_inventory(changed, 'postdeploy')

    def test_postdeploy_still_requires_checkpoint_tables_and_exclusive_funding(self):
        for change in [{'checkpoints_table_present': False}, {'checkpoint_writes_table_present': False},
                       {'runtime_conflicting_funding_active': 1}]:
            changed = self.baseline()
            changed.update(change)
            with self.assertRaises(RuntimeError):
                verify.validate_inventory(changed, 'postdeploy')

    def test_unknown_fields_types_and_negative_counts_fail_closed(self):
        for change in [{'unexpected': 'must-not-be-printed'}, {'app_active': True},
                       {'runtime_waiting': -1}, {'checkpoints_table_present': 1},
                       {'runtime_running': '0'}]:
            changed = self.baseline()
            changed.update(change)
            with self.assertRaises(RuntimeError):
                verify.validate_inventory(changed, 'postdeploy')
        with self.assertRaises(RuntimeError):
            verify.validate_inventory([], 'postdeploy')
        with self.assertRaises(RuntimeError):
            verify.validate_inventory({}, 'postdeploy')

    def test_placeholders_unknown_modes_and_invalid_schema_fail_before_any_process(self):
        cases = [('REPLACE_WITH_REVIEWED_BACKEND_BUILD_SHA', '47', AGENT, 'postdeploy'),
                 (BACKEND, '47', 'REPLACE_WITH_REVIEWED_AGENT_BUILD_SHA', 'postdeploy'),
                 (BACKEND, '48', AGENT, 'postdeploy'),
                 (BACKEND, '47', AGENT, 'predeploy'),
                 (BACKEND, '35', AGENT, 'ignore'),
                 ('a' * 40, '35', AGENT, 'predeploy'),
                 (BACKEND, '35', 'b' * 40, 'predeploy')]
        for args in cases:
            with self.subTest(args=args), patch.object(verify, 'command') as command:
                with self.assertRaises(ValueError):
                    verify.main(*args)
                command.assert_not_called()

    def run_main(self, schema, mode, inventory=None, persisted_env=None):
        inventory = self.baseline() if inventory is None else inventory
        calls = []
        def fake_command(args, **kwargs):
            calls.append(args)
            if args[:2] == ['docker', 'inspect']:
                service = args[2]
                image_sha = BACKEND if service == 'backend' else AGENT
                return json.dumps([{'Image': 'sha256:' + 'c' * 64,
                    'Config': {'Image': f'ghcr.io/jomkeu3369/freelance-ops-{service}:{service}-{image_sha}',
                               'Env': ['APP_BYOK_ENCRYPTION_KEY=' + TEST_KEY,
                                       'APP_CORS_ALLOWED_ORIGINS=https://www.freelance-ops.site']},
                    'State': {'Health': {'Status': 'healthy'}}}])
            if args[:3] == ['docker', 'image', 'inspect']:
                return json.dumps([{'Id': 'sha256:' + 'c' * 64}])
            if args[0] == 'curl':
                return '{"status":"UP"}'
            if args[-1] == verify.INVENTORY_QUERY:
                return json.dumps(inventory)
            if 'MAX(version::int)' in args[-1]:
                return schema
            if 'WHERE NOT success' in args[-1]:
                return '0'
            if args[-1] == 'SELECT version_num FROM agent_runtime.alembic_version':
                return '20260912_0007'
            if args[:2] == ['docker', 'exec'] and '--csv' in args:
                self.assertIn('READ ONLY', args[-1])
                return 'aggregate_count\n0'
            raise AssertionError(f'Unexpected operation shape: {args[:3]}')
        output = io.StringIO()
        with patch.object(verify, 'command', side_effect=fake_command), \
             patch.object(verify, 'container', side_effect=lambda project, service: service), \
             patch.object(verify, 'DEPLOY_ROOT', FakeRoot(persisted_env)), redirect_stdout(output):
            verify.main(BACKEND, schema, AGENT, mode)
        return output.getvalue(), calls

    def test_main_rejects_bad_persisted_key_without_repair_or_creation(self):
        cases = ['', 'APP_BYOK_ENCRYPTION_KEY=invalid\n',
                 'APP_BYOK_ENCRYPTION_KEY=' + TEST_KEY + '\nAPP_BYOK_ENCRYPTION_KEY=' + TEST_KEY + '\n',
                 'APP_BYOK_ENCRYPTION_KEY=' + 'B' * 43 + '=\n']
        for value in cases:
            with self.assertRaisesRegex(RuntimeError, 'Safety configuration failed'):
                self.run_main('35', 'predeploy', persisted_env=value)

    def test_main_accepts_reviewed_schema47_postdeploy(self):
        changed = self.baseline()
        changed.update(app_active=1, runtime_running=1, runtime_scoped_byok_active=1)
        output, calls = self.run_main('47', 'postdeploy', changed)
        self.assertIn('"flyway_version": 47', output)
        self.assertIn('"read_only_verification": true', output)
        self.assertIn('"verification_mode": "postdeploy"', output)
        self.assertNotIn(TEST_KEY, output)
        self.assertIn('"persisted_byok_key_matches_running": true', output)
        self.assertTrue(any(args[-1] == verify.INVENTORY_QUERY for args in calls))

    def test_main_predeploy_accepts_only_exact_reviewed_inventory(self):
        output, _ = self.run_main('35', 'predeploy')
        self.assertIn('"predeploy_inventory_matches_reviewed_boundary": true', output)
        changed = self.baseline()
        changed['app_pending_commands'] = 1
        with self.assertRaisesRegex(RuntimeError, 'app_pending_commands'):
            self.run_main('35', 'predeploy', changed)

    def test_queries_classify_both_json_spellings_and_true_legacy(self):
        source = PATH.read_text()
        self.assertIn("body->'byokBudget'", source)
        self.assertIn("body->'byok_budget'", source)
        self.assertIn("request_json->'byokBudget'", source)
        self.assertIn("request_json->'byok_budget'", source)
        self.assertIn('NOT a.has_platform_budget AND NOT a.has_byok_budget', source)
        self.assertIn('AND NOT has_platform_budget AND NOT has_byok_budget AND has_interruption', source)
        self.assertIn('scoped_byok_start_count', source)
        self.assertIn('conflicting_funding_count', source)
        self.assertNotIn('WHERE NOT a.has_budget', source)
        self.assertIn('READ ONLY', verify.INVENTORY_QUERY)

    def test_predeploy_main_uses_reviewed_boundary_diagnostic_for_structural_change(self):
        for changes in [{'checkpoints_table_present': False}, {'runtime_conflicting_funding_active': 1}]:
            changed = self.baseline()
            changed.update(changes)
            with self.assertRaisesRegex(RuntimeError, 'Predeploy inventory changed; review required'):
                self.run_main('35', 'predeploy', changed)

    def test_supported_predeploy_and_postdeploy_pin_profiles(self):
        verify.validate_expected_release(BACKEND, '35', AGENT, 'predeploy')
        verify.validate_expected_release('c' * 40, '47', 'd' * 40, 'postdeploy')
        with self.assertRaisesRegex(ValueError, 'baseline pins'):
            verify.validate_expected_release('c' * 40, '35', AGENT, 'predeploy')

    def test_workflow_pins_are_a_supported_reviewed_profile_or_safe_postdeploy_template(self):
        text = (ROOT / '.github/workflows/production-release-verify.yml').read_text()
        values = dict(re.findall(r'^          (EXPECTED_BACKEND_SHA|EXPECTED_AGENT_SHA|EXPECTED_SCHEMA|VERIFY_MODE): (\S+)$', text, re.M))
        self.assertEqual(set(values), {'EXPECTED_BACKEND_SHA','EXPECTED_AGENT_SHA','EXPECTED_SCHEMA','VERIFY_MODE'})
        backend, agent = values['EXPECTED_BACKEND_SHA'], values['EXPECTED_AGENT_SHA']
        mode, schema = values['VERIFY_MODE'], values['EXPECTED_SCHEMA']
        if mode == 'predeploy':
            self.assertEqual((backend, schema, agent), (BACKEND, '35', AGENT))
            verify.validate_expected_release(backend, schema, agent, mode)
        else:
            self.assertEqual((mode, schema), ('postdeploy', '47'))
            for key, value in [('BACKEND',backend), ('AGENT',agent)]:
                self.assertTrue(verify.SHA.fullmatch(value) or value == f'REPLACE_WITH_REVIEWED_{key}_BUILD_SHA')
            if verify.SHA.fullmatch(backend) and verify.SHA.fullmatch(agent):
                verify.validate_expected_release(backend, schema, agent, mode)
        self.assertIn('35|46|47)', text)
        self.assertIn("'$EXPECTED_AGENT_SHA' '$VERIFY_MODE'", text)
        self.assertLess(text.index('printf \'%s\' "$EXPECTED_BACKEND_SHA"'), text.index('          ssh -o BatchMode=yes'))


if __name__ == '__main__':
    unittest.main()
