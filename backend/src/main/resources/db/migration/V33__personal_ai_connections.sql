CREATE TABLE app.ai_connection (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES app.workspace(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES app.user_account(id) ON DELETE CASCADE,
    provider VARCHAR(20) NOT NULL CHECK (provider IN ('OPENAI', 'GEMINI')),
    model VARCHAR(100) NOT NULL,
    ciphertext TEXT NOT NULL,
    masked_key VARCHAR(16) NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (workspace_id, user_id, provider)
);
-- Keep the reference after deletion as provenance; never silently switch to platform credentials.
ALTER TABLE app.agent_run ADD COLUMN credential_id UUID;
