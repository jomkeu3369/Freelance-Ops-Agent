CREATE TABLE app.client (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES app.workspace(id) ON DELETE CASCADE,
    name VARCHAR(120) NOT NULL,
    company_name VARCHAR(160),
    email VARCHAR(320),
    phone VARCHAR(40),
    notes VARCHAR(5000),
    status VARCHAR(20) NOT NULL CHECK (status IN ('ACTIVE', 'ARCHIVED')),
    created_by UUID NOT NULL REFERENCES app.user_account(id),
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT uq_client_workspace_id UNIQUE (workspace_id, id)
);

CREATE INDEX ix_client_workspace_updated
    ON app.client(workspace_id, updated_at DESC);

CREATE UNIQUE INDEX uq_client_workspace_email_active
    ON app.client(workspace_id, LOWER(email))
    WHERE status = 'ACTIVE' AND email IS NOT NULL;
