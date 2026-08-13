CREATE TABLE app.project (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES app.workspace(id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    requirement_text VARCHAR(50000) NOT NULL,
    currency VARCHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    deadline DATE,
    budget_min NUMERIC(19, 2) CHECK (budget_min >= 0),
    budget_max NUMERIC(19, 2) CHECK (budget_max >= 0),
    status VARCHAR(20) NOT NULL DEFAULT 'LEAD',
    created_by UUID NOT NULL REFERENCES app.user_account(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT ck_project_budget_range CHECK (
        budget_min IS NULL OR budget_max IS NULL OR budget_min <= budget_max
    ),
    CONSTRAINT uq_project_workspace_scope UNIQUE (workspace_id, id)
);

CREATE INDEX ix_project_workspace_status ON app.project(workspace_id, status);
