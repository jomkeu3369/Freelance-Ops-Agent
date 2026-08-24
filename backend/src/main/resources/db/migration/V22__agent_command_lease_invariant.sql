ALTER TABLE app.agent_run_command
    ADD CONSTRAINT ck_agent_run_command_lease CHECK (
        (status = 'PROCESSING' AND lease_until IS NOT NULL)
        OR (status <> 'PROCESSING' AND lease_until IS NULL)
    );
