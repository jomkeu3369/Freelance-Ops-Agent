CREATE TABLE app.agent_task_command (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL,
    run_id UUID NOT NULL,
    task_id UUID NOT NULL,
    expected_task_revision INTEGER NOT NULL CHECK (expected_task_revision >= 1),
    command_type VARCHAR(30) NOT NULL CHECK (command_type IN (
        'SOFT_UPDATE','HARD_REDIRECT','CANCEL','APPROVE_BUDGET','APPROVE_PERMISSION'
    )),
    idempotency_key VARCHAR(128) NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    requested_by UUID NOT NULL REFERENCES app.user_account(id),
    authorization_revision BIGINT NOT NULL CHECK (authorization_revision >= 1),
    budget_revision BIGINT NOT NULL CHECK (budget_revision >= 1),
    requested_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_agent_task_command_scope FOREIGN KEY (workspace_id, task_id)
        REFERENCES app.agent_task(workspace_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_agent_task_command_run_scope FOREIGN KEY (workspace_id, run_id)
        REFERENCES app.agent_run(workspace_id, id) ON DELETE CASCADE,
    CONSTRAINT uq_agent_task_command_idempotency UNIQUE (workspace_id, task_id, idempotency_key)
);

CREATE INDEX ix_agent_task_command_task_requested
    ON app.agent_task_command(task_id, requested_at, id);

CREATE TABLE app.agent_task_command_delivery (
    command_id UUID PRIMARY KEY REFERENCES app.agent_task_command(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL CHECK (status IN ('PENDING','PROCESSING','DELIVERED','FAILED')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    available_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    lease_until TIMESTAMPTZ,
    last_error VARCHAR(500),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT ck_agent_task_command_delivery_lease CHECK (
        (status = 'PROCESSING' AND lease_until IS NOT NULL)
        OR (status <> 'PROCESSING' AND lease_until IS NULL)
    )
);

CREATE INDEX ix_agent_task_command_delivery_dispatch
    ON app.agent_task_command_delivery(status, available_at, lease_until, created_at);

CREATE TABLE app.agent_task_event (
    event_id VARCHAR(128) PRIMARY KEY,
    workspace_id UUID NOT NULL,
    run_id UUID NOT NULL,
    task_id UUID NOT NULL,
    task_revision INTEGER NOT NULL CHECK (task_revision >= 1),
    attempt_id UUID NOT NULL,
    attempt_number INTEGER NOT NULL CHECK (attempt_number >= 1),
    schema_version VARCHAR(64) NOT NULL,
    source VARCHAR(64) NOT NULL,
    source_event_id VARCHAR(128) NOT NULL,
    sequence INTEGER NOT NULL CHECK (sequence >= 1),
    event_type VARCHAR(64) NOT NULL,
    phase VARCHAR(100),
    milestone VARCHAR(200),
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    occurred_at TIMESTAMPTZ NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_agent_task_event_scope FOREIGN KEY (workspace_id, task_id)
        REFERENCES app.agent_task(workspace_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_agent_task_event_run_scope FOREIGN KEY (workspace_id, run_id)
        REFERENCES app.agent_run(workspace_id, id) ON DELETE CASCADE,
    CONSTRAINT uq_agent_task_event_source UNIQUE (source, source_event_id),
    CONSTRAINT uq_agent_task_event_attempt_sequence UNIQUE (attempt_id, sequence)
);

CREATE INDEX ix_agent_task_event_run_received
    ON app.agent_task_event(run_id, received_at, event_id);
CREATE INDEX ix_agent_task_event_task_received
    ON app.agent_task_event(task_id, received_at, event_id);

CREATE OR REPLACE FUNCTION app.reject_agent_task_command_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'agent_task_command rows are immutable';
END;
$$;

CREATE TRIGGER trg_agent_task_command_immutable
BEFORE UPDATE ON app.agent_task_command
FOR EACH ROW EXECUTE FUNCTION app.reject_agent_task_command_update();
