ALTER TABLE app.agent_run
    ADD CONSTRAINT uq_agent_run_workspace_id UNIQUE (workspace_id, id);

CREATE TABLE app.tool_execution (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL,
    agent_run_id UUID NOT NULL,
    tool_name VARCHAR(100) NOT NULL,
    input_hash CHAR(64) NOT NULL,
    status VARCHAR(20) NOT NULL CHECK (status IN ('STARTED', 'SUCCEEDED', 'FAILED')),
    result_summary VARCHAR(500),
    error_code VARCHAR(100),
    latency_ms BIGINT,
    started_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ,
    CONSTRAINT fk_tool_execution_run_scope
        FOREIGN KEY (workspace_id, agent_run_id)
        REFERENCES app.agent_run(workspace_id, id)
        ON DELETE CASCADE,
    CONSTRAINT ck_tool_execution_completion CHECK (
        (status = 'STARTED' AND completed_at IS NULL AND latency_ms IS NULL)
        OR
        (status IN ('SUCCEEDED', 'FAILED') AND completed_at IS NOT NULL AND latency_ms >= 0)
    )
);

CREATE INDEX ix_tool_execution_run_started
    ON app.tool_execution(workspace_id, agent_run_id, started_at);

CREATE INDEX ix_tool_execution_failures
    ON app.tool_execution(workspace_id, started_at DESC)
    WHERE status = 'FAILED';

CREATE TABLE app.agent_interruption (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL,
    agent_run_id UUID NOT NULL,
    kind VARCHAR(30) NOT NULL CHECK (kind IN ('CLARIFICATION', 'RISK_DECISION', 'QUOTE_APPROVAL')),
    status VARCHAR(20) NOT NULL CHECK (status IN ('PENDING', 'RESPONDED', 'CANCELLED')),
    questions JSONB NOT NULL,
    answers JSONB,
    created_at TIMESTAMPTZ NOT NULL,
    responded_at TIMESTAMPTZ,
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT fk_agent_interruption_run_scope
        FOREIGN KEY (workspace_id, agent_run_id)
        REFERENCES app.agent_run(workspace_id, id)
        ON DELETE CASCADE,
    CONSTRAINT ck_agent_interruption_questions_array
        CHECK (jsonb_typeof(questions) = 'array' AND jsonb_array_length(questions) > 0),
    CONSTRAINT ck_agent_interruption_answers_array
        CHECK (answers IS NULL OR jsonb_typeof(answers) = 'array')
);

CREATE INDEX ix_agent_interruption_run_created
    ON app.agent_interruption(workspace_id, agent_run_id, created_at DESC);

CREATE UNIQUE INDEX uq_agent_interruption_pending_run
    ON app.agent_interruption(agent_run_id)
    WHERE status = 'PENDING';
