CREATE TABLE app.agent_run_command (
    id UUID PRIMARY KEY,
    run_id UUID NOT NULL REFERENCES app.agent_run(id) ON DELETE CASCADE,
    command_type VARCHAR(20) NOT NULL CHECK (command_type IN ('START', 'RESUME')),
    payload TEXT NOT NULL,
    requested_by UUID NOT NULL REFERENCES app.user_account(id),
    effective_permissions TEXT NOT NULL,
    traceparent VARCHAR(55),
    status VARCHAR(20) NOT NULL CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    available_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    lease_until TIMESTAMPTZ,
    last_error VARCHAR(500),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version BIGINT NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX ux_agent_run_command_start
    ON app.agent_run_command(run_id)
    WHERE command_type = 'START';

CREATE INDEX ix_agent_run_command_dispatch
    ON app.agent_run_command(status, available_at, lease_until, created_at);
