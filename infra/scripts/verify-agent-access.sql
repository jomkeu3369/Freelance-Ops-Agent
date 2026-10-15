-- 실제 서비스 계정으로 읽기·쓰기와 스키마 격리를 확인한 뒤 변경을 취소한다.
BEGIN;
SELECT COUNT(*) AS restored_agent_runs FROM agent_runtime.agent_run_state;
CREATE TABLE agent_runtime.__restore_drill_write_probe (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    value integer
);
INSERT INTO agent_runtime.__restore_drill_write_probe (value) VALUES (1);
UPDATE agent_runtime.__restore_drill_write_probe SET value = 2;
DELETE FROM agent_runtime.__restore_drill_write_probe;
DO $$
BEGIN
    BEGIN
        PERFORM 1 FROM app.project LIMIT 1;
        RAISE EXCEPTION 'agent_user unexpectedly accessed app';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
END $$;
ROLLBACK;
