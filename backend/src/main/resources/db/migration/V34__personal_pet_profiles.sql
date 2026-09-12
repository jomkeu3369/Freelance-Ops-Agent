CREATE TABLE app.pet_profile (
    workspace_id UUID NOT NULL REFERENCES app.workspace(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES app.user_account(id) ON DELETE CASCADE,
    slot VARCHAR(20) NOT NULL CHECK (slot IN ('LEAN', 'RECOMMENDED', 'EXPANDED')),
    profile_json TEXT NOT NULL CHECK (length(profile_json) <= 2000),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (workspace_id, user_id, slot)
);
CREATE TABLE app.pet_generation (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES app.workspace(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES app.user_account(id) ON DELETE CASCADE,
    provider VARCHAR(20) NOT NULL,
    model VARCHAR(100) NOT NULL,
    credential_id UUID,
    status VARCHAR(20) NOT NULL DEFAULT 'REQUESTED',
    input_tokens BIGINT,
    output_tokens BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX pet_generation_daily ON app.pet_generation (workspace_id, user_id, created_at);
