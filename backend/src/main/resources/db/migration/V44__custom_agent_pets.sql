-- Personal companions are separate from the three legacy quotation scenarios.
CREATE TABLE app.custom_agent_pet (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES app.workspace(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES app.user_account(id) ON DELETE CASCADE,
    profile_json TEXT NOT NULL CHECK (length(profile_json) <= 12000),
    archived BOOLEAN NOT NULL DEFAULT FALSE,
    revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
    mutation_id UUID NOT NULL,
    mutation_hash VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (workspace_id, user_id, id)
);
CREATE INDEX custom_agent_pet_owner ON app.custom_agent_pet (workspace_id, user_id, created_at, id);
CREATE TABLE app.custom_agent_pet_selection (
    workspace_id UUID NOT NULL REFERENCES app.workspace(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES app.user_account(id) ON DELETE CASCADE,
    pet_id UUID,
    PRIMARY KEY (workspace_id, user_id),
    FOREIGN KEY (workspace_id, user_id, pet_id)
        REFERENCES app.custom_agent_pet(workspace_id, user_id, id)
);
