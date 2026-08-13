CREATE TABLE app.proposal_share (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL,
    quotation_id UUID NOT NULL,
    token_hash CHAR(64) NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_by UUID NOT NULL REFERENCES app.user_account(id),
    created_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT fk_proposal_share_quotation_scope FOREIGN KEY (workspace_id, quotation_id)
        REFERENCES app.quotation(workspace_id, id) ON DELETE CASCADE,
    CONSTRAINT uq_proposal_share_workspace_id UNIQUE (workspace_id, id),
    CONSTRAINT ck_proposal_share_expiry CHECK (expires_at > created_at)
);

CREATE INDEX ix_proposal_share_quotation ON app.proposal_share(workspace_id, quotation_id, created_at DESC);
