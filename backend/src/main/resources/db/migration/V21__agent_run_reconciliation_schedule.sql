ALTER TABLE app.agent_run
    ADD COLUMN next_reconciliation_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX ix_agent_run_reconciliation
    ON app.agent_run(status, next_reconciliation_at)
    WHERE status IN ('QUEUED', 'RUNNING', 'WAITING_FOR_USER');
