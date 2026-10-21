CREATE TABLE app.rate_card_folder (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES app.workspace(id) ON DELETE CASCADE,
    parent_id UUID,
    name VARCHAR(120) NOT NULL CHECK (length(btrim(name)) > 0),
    created_by UUID NOT NULL REFERENCES app.user_account(id),
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT uq_rate_card_folder_workspace_id UNIQUE (workspace_id, id),
    CONSTRAINT fk_rate_card_folder_parent_scope FOREIGN KEY (workspace_id, parent_id)
        REFERENCES app.rate_card_folder(workspace_id, id),
    CONSTRAINT ck_rate_card_folder_parent CHECK (parent_id IS NULL OR parent_id <> id)
);

CREATE UNIQUE INDEX uq_rate_card_folder_root_name
    ON app.rate_card_folder(workspace_id, lower(name)) WHERE parent_id IS NULL;
CREATE UNIQUE INDEX uq_rate_card_folder_child_name
    ON app.rate_card_folder(workspace_id, parent_id, lower(name)) WHERE parent_id IS NOT NULL;
CREATE INDEX ix_rate_card_folder_parent ON app.rate_card_folder(workspace_id, parent_id);

ALTER TABLE app.rate_card ADD COLUMN folder_id UUID;
ALTER TABLE app.rate_card ADD CONSTRAINT fk_rate_card_folder_scope
    FOREIGN KEY (workspace_id, folder_id) REFERENCES app.rate_card_folder(workspace_id, id);
CREATE INDEX ix_rate_card_workspace_folder ON app.rate_card(workspace_id, folder_id);
