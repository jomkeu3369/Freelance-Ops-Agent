-- Staging only; originals are never stored. Sent text lives in the existing run retention boundary.
CREATE TABLE app.chat_attachment (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES app.workspace(id) ON DELETE CASCADE,
    project_id UUID NOT NULL,
    owner_id UUID NOT NULL REFERENCES app.user_account(id) ON DELETE CASCADE,
    payload JSONB NOT NULL CHECK (octet_length(payload::text) <= 500000),
    expires_at TIMESTAMPTZ NOT NULL,
    FOREIGN KEY (workspace_id, project_id) REFERENCES app.project(workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX ix_chat_attachment_expiry ON app.chat_attachment(expires_at);
CREATE INDEX ix_chat_attachment_owner ON app.chat_attachment(owner_id);
