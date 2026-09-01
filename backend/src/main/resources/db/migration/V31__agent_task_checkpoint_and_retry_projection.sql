ALTER TABLE app.agent_task DROP CONSTRAINT ck_agent_task_status;
ALTER TABLE app.agent_task ADD CONSTRAINT ck_agent_task_status CHECK (status IN (
    'QUEUED','DISPATCHED','RUNNING','WAITING_FOR_TOOL','WAITING_FOR_USER','UPDATE_PENDING',
    'RETRY_WAIT','WAITING_FOR_CAPACITY','CANCELLING','CANCELLED','COMPLETED','COMPLETED_REUSED',
    'FAILED','TIMED_OUT'
));

ALTER TABLE app.agent_task_attempt
    ADD COLUMN checkpoint_id VARCHAR(128),
    ADD COLUMN checkpoint_artifact_reference VARCHAR(500),
    ADD COLUMN checkpoint_restored_seconds DOUBLE PRECISION,
    ADD COLUMN completed_steps JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN side_effect_idempotency_keys JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN failure_classification VARCHAR(40),
    ADD COLUMN classification_confidence DOUBLE PRECISION,
    ADD COLUMN classifier_version VARCHAR(100),
    ADD COLUMN retry_decision VARCHAR(20),
    ADD COLUMN retry_reason VARCHAR(80),
    ADD COLUMN retry_ready_at TIMESTAMPTZ,
    ADD COLUMN retry_snapshot JSONB;

ALTER TABLE app.agent_task_attempt ADD CONSTRAINT ck_agent_task_attempt_checkpoint_restored
    CHECK (checkpoint_restored_seconds IS NULL OR checkpoint_restored_seconds >= 0);
ALTER TABLE app.agent_task_attempt ADD CONSTRAINT ck_agent_task_attempt_classification_confidence
    CHECK (classification_confidence IS NULL OR classification_confidence BETWEEN 0 AND 1);
ALTER TABLE app.agent_task_attempt ADD CONSTRAINT ck_agent_task_attempt_retry_decision
    CHECK (retry_decision IS NULL OR retry_decision IN ('ALLOW','DENY'));
