CREATE TABLE app.project_pet_conversation (
    workspace_id UUID NOT NULL REFERENCES app.workspace(id) ON DELETE CASCADE,
    project_id UUID NOT NULL,
    user_id UUID NOT NULL REFERENCES app.user_account(id) ON DELETE CASCADE,
    settings_json JSONB NOT NULL,
    version BIGINT NOT NULL DEFAULT 1 CHECK (version >= 1),
    PRIMARY KEY (workspace_id, project_id, user_id),
    FOREIGN KEY (workspace_id, project_id) REFERENCES app.project(workspace_id, id) ON DELETE CASCADE
);
CREATE TABLE app.project_pet_turn (
    run_id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES app.workspace(id) ON DELETE CASCADE,
    project_id UUID NOT NULL,
    user_id UUID NOT NULL REFERENCES app.user_account(id) ON DELETE CASCADE,
    user_text TEXT NOT NULL,
    messages_json JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (workspace_id, project_id) REFERENCES app.project(workspace_id, id) ON DELETE CASCADE,
    FOREIGN KEY (workspace_id, run_id) REFERENCES app.agent_run(workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX ix_project_pet_turn_history ON app.project_pet_turn(workspace_id, project_id, user_id, created_at DESC);
