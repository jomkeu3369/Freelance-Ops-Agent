INSERT INTO app.permission (code, description)
VALUES ('agent.route.review', 'Review Agent routing decisions')
ON CONFLICT (code) DO NOTHING;

INSERT INTO app.role_permission (workspace_id, role_id, permission_code)
SELECT workspace_id, id, 'agent.route.review'
FROM app.workspace_role
WHERE code IN ('OWNER', 'ADMIN', 'MANAGER')
ON CONFLICT (role_id, permission_code) DO NOTHING;

CREATE TABLE app.agent_route_collection (
    agent_run_id UUID PRIMARY KEY REFERENCES app.agent_run(id) ON DELETE CASCADE,
    cursor_event_id BIGINT NOT NULL DEFAULT 0 CHECK (cursor_event_id >= 0),
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    available_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    lease_until TIMESTAMPTZ,
    last_error VARCHAR(500),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version BIGINT NOT NULL DEFAULT 0
);

CREATE INDEX ix_agent_route_collection_dispatch
    ON app.agent_route_collection(status, available_at, lease_until);

CREATE TABLE app.agent_route_observation (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL,
    project_id UUID NOT NULL,
    agent_run_id UUID NOT NULL,
    agent_event_id BIGINT NOT NULL CHECK (agent_event_id > 0),
    occurred_at TIMESTAMPTZ NOT NULL,
    route_data JSONB NOT NULL,
    captured_at TIMESTAMPTZ NOT NULL,
    gold_route VARCHAR(30) CHECK (gold_route IN ('DIRECT_TOOL', 'SIMPLE_LLM', 'REACT_AGENT', 'SUPERVISOR', 'HUMAN_REQUIRED')),
    correction_source VARCHAR(30) CHECK (correction_source IN ('HUMAN_REVIEW', 'USER_EDIT', 'POLICY_REPLAY')),
    reviewed_by UUID REFERENCES app.user_account(id),
    reviewed_at TIMESTAMPTZ,
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT uq_agent_route_observation_event UNIQUE (agent_run_id, agent_event_id),
    CONSTRAINT uq_agent_route_observation_scope UNIQUE (workspace_id, id),
    CONSTRAINT fk_agent_route_observation_run_scope FOREIGN KEY (workspace_id, agent_run_id)
        REFERENCES app.agent_run(workspace_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_agent_route_observation_project_scope FOREIGN KEY (workspace_id, project_id)
        REFERENCES app.project(workspace_id, id) ON DELETE CASCADE,
    CONSTRAINT ck_agent_route_observation_data_object CHECK (jsonb_typeof(route_data) = 'object'),
    CONSTRAINT ck_agent_route_observation_review_complete CHECK (
        (gold_route IS NULL AND correction_source IS NULL AND reviewed_by IS NULL AND reviewed_at IS NULL)
        OR
        (gold_route IS NOT NULL AND correction_source IS NOT NULL AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
    )
);

CREATE INDEX ix_agent_route_observation_review_queue
    ON app.agent_route_observation(workspace_id, occurred_at, id)
    WHERE reviewed_at IS NULL;

CREATE OR REPLACE FUNCTION app.enqueue_agent_route_collection()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO app.agent_route_collection(agent_run_id) VALUES (NEW.id)
    ON CONFLICT (agent_run_id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_enqueue_agent_route_collection
AFTER INSERT ON app.agent_run
FOR EACH ROW EXECUTE FUNCTION app.enqueue_agent_route_collection();

INSERT INTO app.agent_route_collection(agent_run_id)
SELECT id FROM app.agent_run
ON CONFLICT (agent_run_id) DO NOTHING;
