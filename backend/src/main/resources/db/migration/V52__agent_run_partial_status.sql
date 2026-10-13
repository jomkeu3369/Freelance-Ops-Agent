-- PARTIAL is a durable terminal outcome in the shared run protocol. Preserve it
-- as PARTIAL rather than losing the projection or promoting an incomplete result.
ALTER TABLE app.agent_run DROP CONSTRAINT agent_run_status_check;
ALTER TABLE app.agent_run ADD CONSTRAINT agent_run_status_check CHECK (
    status IN ('QUEUED', 'RUNNING', 'WAITING_FOR_USER', 'COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED')
);
