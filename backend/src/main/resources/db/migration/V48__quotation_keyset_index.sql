-- Stable keyset order for bounded quotation history. Retain the existing index
-- until deployment-specific index usage is reviewed separately.
CREATE INDEX ix_quotation_project_created_id
    ON app.quotation(workspace_id, project_id, created_at DESC, id DESC);
