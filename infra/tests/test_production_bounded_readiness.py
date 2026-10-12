import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('load', Path(__file__).parents[1] / 'scripts/production-bounded-readiness.py')
load = importlib.util.module_from_spec(spec)
spec.loader.exec_module(load)

class GuardrailTests(unittest.TestCase):
    def setUp(self):
        self.metrics = dict(cpu_percent=10, cpu_count=2, load1=.1, memory_available_percent=50,
                            memory_available_mib=512, disk_free_percent=50, disk_free_gib=10)
        self.db = dict(connections_total=10, max_connections=100, app_waiting_connections=0,
                       app_active_runs=0, app_pending_commands=0, runtime_active_runs=0,
                       unfinished_tasks=0, pending_scheduler_entries=0, schema_version=47)

    def test_healthy_baseline(self):
        load.check_safety(self.metrics, self.db)

    def test_resource_pressure_aborts(self):
        for key, value in [('cpu_percent',85), ('load1',4), ('memory_available_percent',14),
                           ('memory_available_mib',127), ('disk_free_percent',9), ('disk_free_gib',.9)]:
            with self.subTest(key=key), self.assertRaises(load.Abort):
                load.check_safety({**self.metrics, key:value}, self.db)

    def test_database_pressure_and_active_work_aborts(self):
        for key, value in [('connections_total',80), ('app_waiting_connections',1), ('app_active_runs',1),
                           ('app_pending_commands',1), ('runtime_active_runs',1), ('unfinished_tasks',1),
                           ('pending_scheduler_entries',1), ('schema_version',46)]:
            with self.subTest(key=key), self.assertRaises(load.Abort):
                load.check_safety(self.metrics, {**self.db, key:value})

    def test_auth_errors_and_down_never_count_success(self):
        summary = load.summarize([{'status':200,'up':True,'ms':1}, {'status':401,'up':False,'ms':2},
                                  {'status':404,'up':False,'ms':3}, {'status':200,'up':False,'ms':4}], 1)
        self.assertEqual(summary['errors'],3)
        self.assertEqual(summary['p95_ms'],4)

    def test_redirects_not_followed(self):
        self.assertIsNone(load.NoRedirect().redirect_request(None,None,302,'',{},'https://example.com'))

    def test_fixed_readiness_scope(self):
        self.assertEqual(load.RATES,(1,2,5))
        self.assertEqual(load.MAX_CONCURRENT,5)
        self.assertEqual(load.STAGE_SECONDS,30)
        self.assertTrue(all(url.endswith('/actuator/health/readiness') for url in load.TARGETS.values()))
        self.assertIn('READ ONLY',load.DB_QUERY)
        for forbidden in ('INSERT','UPDATE','DELETE','request_json','password'):
            self.assertNotIn(forbidden,load.DB_QUERY)

    def test_preflight_never_starts_stage(self):
        with patch.object(load,'emit'), patch.object(load,'container',return_value='abcdef123456'), \
             patch.object(load,'observe'), patch.object(load,'request',return_value={'status':200,'up':True}), \
             patch.object(load,'stage') as stage:
            load.main('preflight')
            stage.assert_not_called()

if __name__ == '__main__':
    unittest.main()
