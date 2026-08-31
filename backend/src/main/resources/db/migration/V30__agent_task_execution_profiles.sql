ALTER TABLE app.agent_run
    ADD COLUMN reasoning_effort VARCHAR(20) NOT NULL DEFAULT 'LOW'
        CHECK (reasoning_effort IN ('NONE','LOW','MEDIUM','HIGH')),
    ADD COLUMN max_duration_seconds INTEGER NOT NULL DEFAULT 180 CHECK (max_duration_seconds >= 1),
    ADD COLUMN max_model_calls INTEGER NOT NULL DEFAULT 50 CHECK (max_model_calls >= 0),
    ADD COLUMN max_tool_calls INTEGER NOT NULL DEFAULT 12 CHECK (max_tool_calls >= 0),
    ADD COLUMN max_input_tokens INTEGER NOT NULL DEFAULT 50000 CHECK (max_input_tokens >= 0),
    ADD COLUMN max_output_tokens INTEGER NOT NULL DEFAULT 48000 CHECK (max_output_tokens >= 0),
    ADD COLUMN max_departments INTEGER NOT NULL DEFAULT 4 CHECK (max_departments >= 1),
    ADD COLUMN max_hierarchy_depth INTEGER NOT NULL DEFAULT 2 CHECK (max_hierarchy_depth >= 1),
    ADD COLUMN max_search_credits INTEGER NOT NULL DEFAULT 2 CHECK (max_search_credits >= 0),
    ADD COLUMN max_retries INTEGER NOT NULL DEFAULT 2 CHECK (max_retries >= 0),
    ADD COLUMN max_handoffs INTEGER NOT NULL DEFAULT 3 CHECK (max_handoffs >= 0);

CREATE TABLE app.agent_task_execution_profile (
    task_id UUID NOT NULL,
    task_revision INTEGER NOT NULL CHECK (task_revision >= 1),
    workspace_id UUID NOT NULL,
    run_id UUID NOT NULL,
    route VARCHAR(30) NOT NULL CHECK (route IN (
        'DIRECT_TOOL','SIMPLE_LLM','REACT_AGENT','SUPERVISOR','HUMAN_REQUIRED'
    )),
    risk_level VARCHAR(20) NOT NULL CHECK (risk_level IN ('LOW','MEDIUM','HIGH','RESTRICTED')),
    model_profile VARCHAR(100) NOT NULL,
    tool_profile VARCHAR(30) NOT NULL CHECK (tool_profile IN ('NONE','READ_ONLY','BOUNDED_WRITE')),
    provider VARCHAR(20) NOT NULL CHECK (provider IN ('OPENAI','GEMINI')),
    model VARCHAR(100) NOT NULL,
    reasoning_effort VARCHAR(20) NOT NULL CHECK (reasoning_effort IN ('NONE','LOW','MEDIUM','HIGH')),
    permissions JSONB NOT NULL,
    max_duration_seconds INTEGER NOT NULL CHECK (max_duration_seconds >= 1),
    max_model_calls INTEGER NOT NULL CHECK (max_model_calls >= 0),
    max_tool_calls INTEGER NOT NULL CHECK (max_tool_calls >= 0),
    max_input_tokens INTEGER NOT NULL CHECK (max_input_tokens >= 0),
    max_output_tokens INTEGER NOT NULL CHECK (max_output_tokens >= 0),
    max_departments INTEGER NOT NULL CHECK (max_departments >= 1),
    max_hierarchy_depth INTEGER NOT NULL CHECK (max_hierarchy_depth >= 1),
    max_search_credits INTEGER NOT NULL CHECK (max_search_credits >= 0),
    max_retries INTEGER NOT NULL CHECK (max_retries >= 0),
    max_handoffs INTEGER NOT NULL CHECK (max_handoffs >= 0),
    authorization_revision BIGINT NOT NULL CHECK (authorization_revision >= 1),
    budget_revision BIGINT NOT NULL CHECK (budget_revision >= 1),
    route_profile_version VARCHAR(100) NOT NULL,
    guard_policy_version VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (task_id, task_revision),
    CONSTRAINT fk_agent_task_profile_scope FOREIGN KEY (workspace_id, task_id)
        REFERENCES app.agent_task(workspace_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_agent_task_profile_run_scope FOREIGN KEY (workspace_id, run_id)
        REFERENCES app.agent_run(workspace_id, id) ON DELETE CASCADE,
    CONSTRAINT ck_agent_task_profile_permissions_array CHECK (jsonb_typeof(permissions) = 'array'),
    CONSTRAINT ck_agent_task_profile_automatic CHECK (
        route <> 'HUMAN_REQUIRED' AND risk_level <> 'RESTRICTED'
    ),
    CONSTRAINT ck_agent_task_profile_tool_route CHECK (
        (route IN ('DIRECT_TOOL','REACT_AGENT','SUPERVISOR') AND tool_profile = 'READ_ONLY')
        OR (route = 'SIMPLE_LLM' AND tool_profile = 'NONE')
    )
);

CREATE INDEX ix_agent_task_execution_profile_run
    ON app.agent_task_execution_profile(run_id, task_id, task_revision);

CREATE OR REPLACE FUNCTION app.reject_agent_task_profile_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'agent_task_execution_profile rows are immutable';
END;
$$;

CREATE TRIGGER trg_agent_task_execution_profile_immutable
BEFORE UPDATE ON app.agent_task_execution_profile
FOR EACH ROW EXECUTE FUNCTION app.reject_agent_task_profile_update();
