CREATE TABLE app.estimation_policy_proposal (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES app.workspace(id) ON DELETE CASCADE,
    project_id UUID NOT NULL,
    source_message VARCHAR(50000) NOT NULL CHECK (length(trim(source_message)) > 0),
    created_by UUID NOT NULL REFERENCES app.user_account(id),
    idempotency_key UUID NOT NULL,
    confirmation_token UUID NOT NULL,
    base_version BIGINT NOT NULL CHECK (base_version >= 0),
    before_tax_rate NUMERIC(7, 6) NOT NULL CHECK (before_tax_rate BETWEEN 0 AND 1),
    before_risk_buffer_rate NUMERIC(7, 6) NOT NULL CHECK (before_risk_buffer_rate BETWEEN 0 AND 1),
    before_maximum_discount_rate NUMERIC(7, 6) NOT NULL CHECK (before_maximum_discount_rate BETWEEN 0 AND 1),
    proposed_tax_rate NUMERIC(7, 6) NOT NULL CHECK (proposed_tax_rate BETWEEN 0 AND 1),
    proposed_risk_buffer_rate NUMERIC(7, 6) NOT NULL CHECK (proposed_risk_buffer_rate BETWEEN 0 AND 1),
    proposed_maximum_discount_rate NUMERIC(7, 6) NOT NULL CHECK (proposed_maximum_discount_rate BETWEEN 0 AND 1),
    status VARCHAR(16) NOT NULL CHECK (status IN ('PENDING', 'APPLIED')),
    created_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    applied_at TIMESTAMPTZ,
    applied_policy_version BIGINT,
    CONSTRAINT uq_policy_proposal_idempotency UNIQUE (workspace_id, created_by, idempotency_key),
    CONSTRAINT fk_policy_proposal_project_scope FOREIGN KEY (workspace_id, project_id)
        REFERENCES app.project(workspace_id, id) ON DELETE CASCADE,
    CONSTRAINT ck_policy_proposal_applied CHECK (
        (status = 'PENDING' AND applied_at IS NULL AND applied_policy_version IS NULL)
        OR (status = 'APPLIED' AND applied_at IS NOT NULL AND applied_policy_version IS NOT NULL)
    )
);

CREATE INDEX ix_policy_proposal_workspace_created ON app.estimation_policy_proposal(workspace_id, created_at DESC);
CREATE INDEX ix_policy_proposal_project_created ON app.estimation_policy_proposal(workspace_id, project_id, created_at DESC);
