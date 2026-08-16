ALTER TABLE app.quotation
    DROP CONSTRAINT fk_quotation_previous_scope,
    ADD CONSTRAINT fk_quotation_previous_scope
        FOREIGN KEY (workspace_id, previous_version_id)
        REFERENCES app.quotation(workspace_id, id)
        ON DELETE CASCADE;

ALTER TABLE app.quotation_item
    DROP CONSTRAINT fk_quotation_item_assumption,
    ADD CONSTRAINT fk_quotation_item_assumption
        FOREIGN KEY (quotation_id, assumption_id)
        REFERENCES app.quotation_assumption(quotation_id, id)
        ON DELETE CASCADE,
    DROP CONSTRAINT fk_quotation_item_evidence,
    ADD CONSTRAINT fk_quotation_item_evidence
        FOREIGN KEY (quotation_id, evidence_id)
        REFERENCES app.quotation_evidence(quotation_id, id)
        ON DELETE CASCADE;

ALTER TABLE app.actual_outcome
    DROP CONSTRAINT fk_outcome_quotation_scope,
    ADD CONSTRAINT fk_outcome_quotation_scope
        FOREIGN KEY (workspace_id, approved_quotation_id)
        REFERENCES app.quotation(workspace_id, id)
        ON DELETE SET NULL (approved_quotation_id);

ALTER TABLE app.actual_work_item
    DROP CONSTRAINT fk_work_item_quotation_scope,
    ADD CONSTRAINT fk_work_item_quotation_scope
        FOREIGN KEY (workspace_id, quotation_item_id)
        REFERENCES app.quotation_item(workspace_id, id)
        ON DELETE SET NULL (quotation_item_id);

ALTER TABLE app.quotation_decision
    DROP CONSTRAINT fk_quotation_decision_share_scope,
    ADD CONSTRAINT fk_quotation_decision_share_scope
        FOREIGN KEY (workspace_id, share_id)
        REFERENCES app.proposal_share(workspace_id, id)
        ON DELETE CASCADE;
