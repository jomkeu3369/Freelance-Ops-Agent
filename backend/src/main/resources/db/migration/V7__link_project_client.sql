ALTER TABLE app.project
    ADD COLUMN client_id UUID;

ALTER TABLE app.project
    ADD CONSTRAINT fk_project_client_scope
    FOREIGN KEY (workspace_id, client_id)
    REFERENCES app.client(workspace_id, id);

CREATE INDEX ix_project_workspace_client
    ON app.project(workspace_id, client_id)
    WHERE client_id IS NOT NULL;
