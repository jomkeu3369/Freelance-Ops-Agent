"""Create the versioned Agent runtime baseline and async task registry."""

from alembic import op

revision = "20260831_0001"
down_revision = None
branch_labels = None
depends_on = None

UPGRADE_SQL = """
CREATE SCHEMA IF NOT EXISTS agent_runtime;

CREATE TABLE IF NOT EXISTS agent_runtime.agent_run_state (
    run_id UUID PRIMARY KEY,
    request_json JSONB NOT NULL,
    status VARCHAR(32) NOT NULL,
    active_department VARCHAR(32),
    interruption_json JSONB,
    result_json JSONB,
    usage_json JSONB,
    error_code VARCHAR(100),
    idempotency_keys JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_agent_run_state_status_updated_at
    ON agent_runtime.agent_run_state(status, updated_at);

CREATE TABLE IF NOT EXISTS agent_runtime.agent_run_event (
    run_id UUID NOT NULL REFERENCES agent_runtime.agent_run_state(run_id) ON DELETE CASCADE,
    event_id BIGINT NOT NULL,
    type VARCHAR(100) NOT NULL,
    data_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    occurred_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (run_id, event_id)
);

CREATE INDEX IF NOT EXISTS ix_agent_run_event_run_occurred
    ON agent_runtime.agent_run_event(run_id, occurred_at);

CREATE TABLE IF NOT EXISTS agent_runtime.agent_task (
    task_id UUID NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 1),
    run_id UUID NOT NULL REFERENCES agent_runtime.agent_run_state(run_id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL,
    project_id UUID NOT NULL,
    department VARCHAR(32) NOT NULL,
    status VARCHAR(32) NOT NULL,
    priority INTEGER NOT NULL CHECK (priority BETWEEN 1 AND 5),
    dependency_task_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    execution_json JSONB NOT NULL,
    schema_version VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (task_id, revision),
    CONSTRAINT ck_agent_task_status CHECK (
        status IN ('SUBMITTED','ADMITTED','DEFERRED','QUEUED','RUNNING','CHECKPOINTED','PAUSED',
        'RETRY_WAIT','WAITING_FOR_CAPACITY','COMPLETED','FAILED','CANCELLED','REJECTED','SUPERSEDED')
    )
);

CREATE INDEX IF NOT EXISTS ix_agent_task_workspace_status_priority
    ON agent_runtime.agent_task(workspace_id, status, priority, created_at);
CREATE INDEX IF NOT EXISTS ix_agent_task_run_status
    ON agent_runtime.agent_task(run_id, status);

CREATE TABLE IF NOT EXISTS agent_runtime.agent_task_attempt (
    attempt_id UUID PRIMARY KEY,
    task_id UUID NOT NULL,
    task_revision INTEGER NOT NULL,
    run_id UUID NOT NULL REFERENCES agent_runtime.agent_run_state(run_id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL,
    attempt_number INTEGER NOT NULL CHECK (attempt_number >= 1),
    status VARCHAR(32) NOT NULL,
    predicted_service_runtime_seconds DOUBLE PRECISION CHECK (predicted_service_runtime_seconds >= 0),
    predictor_version VARCHAR(100),
    queued_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    schema_version VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT fk_agent_task_attempt_task FOREIGN KEY (task_id, task_revision)
        REFERENCES agent_runtime.agent_task(task_id, revision) ON DELETE CASCADE,
    CONSTRAINT uq_agent_task_attempt_number UNIQUE (task_id, task_revision, attempt_number),
    CONSTRAINT ck_agent_task_attempt_status CHECK (
        status IN ('PREDICTED','QUEUED','RUNNING','CHECKPOINTED','COMPLETED','FAILED','CANCELLED','SUPERSEDED')
    ),
    CONSTRAINT ck_agent_task_attempt_prediction_pair CHECK (
        (predicted_service_runtime_seconds IS NULL AND predictor_version IS NULL)
        OR (predicted_service_runtime_seconds IS NOT NULL AND predictor_version IS NOT NULL)
    ),
    CONSTRAINT ck_agent_task_attempt_time_order CHECK (
        (queued_at IS NULL OR started_at IS NULL OR queued_at <= started_at)
        AND (started_at IS NULL OR finished_at IS NULL OR started_at <= finished_at)
    )
);

CREATE INDEX IF NOT EXISTS ix_agent_task_attempt_workspace_status
    ON agent_runtime.agent_task_attempt(workspace_id, status, created_at);
CREATE INDEX IF NOT EXISTS ix_agent_task_attempt_task_status
    ON agent_runtime.agent_task_attempt(task_id, task_revision, status);

CREATE TABLE IF NOT EXISTS agent_runtime.agent_task_event (
    event_id VARCHAR(128) PRIMARY KEY,
    run_id UUID NOT NULL REFERENCES agent_runtime.agent_run_state(run_id) ON DELETE CASCADE,
    schema_version VARCHAR(64) NOT NULL,
    source VARCHAR(64) NOT NULL,
    source_event_id VARCHAR(128) NOT NULL,
    task_id VARCHAR(128) NOT NULL,
    attempt_id VARCHAR(128) NOT NULL,
    attempt_number INTEGER NOT NULL,
    workspace_id UUID NOT NULL,
    sequence INTEGER NOT NULL,
    event_type VARCHAR(64) NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL,
    received_at TIMESTAMPTZ NOT NULL,
    data_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    CONSTRAINT uq_agent_task_event_source UNIQUE (source, source_event_id),
    CONSTRAINT uq_agent_task_event_attempt_sequence UNIQUE (attempt_id, sequence)
);

CREATE INDEX IF NOT EXISTS ix_agent_task_event_run_received
    ON agent_runtime.agent_task_event(run_id, received_at, event_id);
CREATE INDEX IF NOT EXISTS ix_agent_task_event_attempt_occurred
    ON agent_runtime.agent_task_event(attempt_id, occurred_at);
"""

DOWNGRADE_SQL = """
DROP TABLE IF EXISTS agent_runtime.agent_task_event;
DROP TABLE IF EXISTS agent_runtime.agent_task_attempt;
DROP TABLE IF EXISTS agent_runtime.agent_task;
DROP TABLE IF EXISTS agent_runtime.agent_run_event;
DROP TABLE IF EXISTS agent_runtime.agent_run_state;
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
