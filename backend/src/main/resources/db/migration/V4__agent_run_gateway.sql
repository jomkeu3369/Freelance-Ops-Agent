CREATE TABLE app.agent_run (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES app.workspace(id) ON DELETE CASCADE,
    project_id UUID NOT NULL,
    thread_id UUID NOT NULL,
    initiated_by UUID NOT NULL REFERENCES app.user_account(id),
    provider VARCHAR(20) NOT NULL CHECK (provider IN ('OPENAI', 'GEMINI')),
    model VARCHAR(100) NOT NULL,
    status VARCHAR(30) NOT NULL CHECK (
        status IN ('QUEUED', 'RUNNING', 'WAITING_FOR_USER', 'COMPLETED', 'FAILED', 'CANCELLED')
    ),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT fk_agent_run_project_scope
        FOREIGN KEY (workspace_id, project_id)
        REFERENCES app.project(workspace_id, id)
        ON DELETE CASCADE
);

CREATE INDEX ix_agent_run_workspace_updated ON app.agent_run(workspace_id, updated_at DESC);
CREATE INDEX ix_agent_run_project_updated ON app.agent_run(workspace_id, project_id, updated_at DESC);
