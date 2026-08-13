ALTER TABLE app.quotation_decision
    ALTER COLUMN decided_by DROP NOT NULL,
    ADD COLUMN share_id UUID,
    ADD COLUMN client_name VARCHAR(120),
    ADD COLUMN client_email VARCHAR(320),
    ADD CONSTRAINT fk_quotation_decision_share_scope FOREIGN KEY (workspace_id, share_id)
        REFERENCES app.proposal_share(workspace_id, id),
    ADD CONSTRAINT ck_quotation_decision_actor CHECK (
        (decided_by IS NOT NULL AND share_id IS NULL)
        OR (decided_by IS NULL AND share_id IS NOT NULL AND client_name IS NOT NULL)
    ),
    ADD CONSTRAINT uq_quotation_decision_share UNIQUE (share_id);
