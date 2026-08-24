ALTER TABLE app.project
    ADD COLUMN deletion_requested_at TIMESTAMPTZ;

CREATE INDEX ix_project_deletion_requested
    ON app.project(deletion_requested_at)
    WHERE deletion_requested_at IS NOT NULL;
