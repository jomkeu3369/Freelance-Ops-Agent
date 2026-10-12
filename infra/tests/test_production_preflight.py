import importlib.util
import json
import pathlib
import unittest
from unittest.mock import patch
p=pathlib.Path(__file__).resolve().parents[1] / 'scripts' / 'production-preflight.py'
spec=importlib.util.spec_from_file_location('preflight',p)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
HOST={'cpu_percent':2,'load1':0.1,'cpu_count':1,'memory_available_percent':40,'memory_available_mib':800,'disk_free_percent':40,'disk_free_gib':10}
DB={'connections_total':18,'max_connections':100,'app_waiting_connections':0,'app_active_runs':0,'app_pending_commands':0,'runtime_active_runs':0,'unfinished_tasks':0,'pending_scheduler_entries':0,'schema_version':47}
CAT={'quotation_conflicting_locks':0,'idle_in_transaction':0,'lock_waiting_sessions':0,'prepared_transactions':0,'other_oldest_transaction_seconds':0,'quotation_indexes':[{'name':'quotation_pkey','valid':True,'ready':True}]}
class Tests(unittest.TestCase):
 def test_safe_gates(self):m.check_safety(HOST,DB)
 def test_host_gates(self):
  for key,value in [('cpu_percent',85),('load1',2),('memory_available_percent',14),('memory_available_mib',127),('disk_free_percent',9),('disk_free_gib',0.9)]:
   with self.subTest(key=key),self.assertRaises(RuntimeError):m.check_safety({**HOST,key:value},DB)
 def test_db_gates(self):
  for key,value in [('connections_total',80),('app_waiting_connections',1),('app_active_runs',1),('app_pending_commands',1),('runtime_active_runs',1),('unfinished_tasks',1),('pending_scheduler_entries',1),('schema_version',48)]:
   with self.subTest(key=key),self.assertRaises(RuntimeError):m.check_safety(HOST,{**DB,key:value})
 def run_catalog(self,catalog):
  with patch.object(m,'resources',return_value=HOST),patch.object(m,'db_metrics',return_value=DB),patch.object(m,'command',return_value=json.dumps(catalog)),patch('builtins.print'):
   return m.migration_preflight('synthetic')
 def test_catalog_safe(self):self.assertEqual(self.run_catalog(CAT)['database'],DB)
 def test_catalog_guards(self):
  for key in ('quotation_conflicting_locks','idle_in_transaction','lock_waiting_sessions','prepared_transactions'):
   with self.subTest(key=key),self.assertRaises(RuntimeError):self.run_catalog({**CAT,key:1})
  with self.assertRaises(RuntimeError):self.run_catalog({**CAT,'other_oldest_transaction_seconds':31})
  with self.assertRaises(RuntimeError):self.run_catalog({**CAT,'quotation_indexes':[{'name':'ix_quotation_project_created_id','valid':True,'ready':True}]})
  with self.assertRaises(RuntimeError):self.run_catalog({**CAT,'quotation_indexes':[{'name':'quotation_pkey','valid':False,'ready':True}]})
 def test_read_only_queries(self):
  for q in (m.DB_QUERY,m.MIGRATION_METADATA_QUERY):
   self.assertIn('READ ONLY',q);self.assertIn("statement_timeout='2s'",q);self.assertIn("lock_timeout='500ms'",q)
   for sql in ('CREATE INDEX','DROP ','DELETE ','UPDATE ','INSERT ','SELECT *','query,','client_addr'):
    self.assertNotIn(sql,q)
 def test_snapshot_bounds(self):
  s=p.read_text()
  for token in ('4 * 1024**3','db_size + 1024**3','--lock-wait-timeout=10s',"--format', 'custom'",'--file=/dev/null',"'restore_drill_performed': False","'off_host_backup_verified': False",'0o700','0o600'):
   self.assertIn(token,s)
  self.assertEqual(s.count('sha256(dump)'),2)
 def test_no_deploy_or_restore(self):
  s=p.read_text()
  for token in ('docker compose','docker login','pg_restore --dbname','CREATE INDEX','rclone copy','authorized_keys'):
   self.assertNotIn(token,s)
if __name__=='__main__':unittest.main()
