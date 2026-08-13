CREATE TABLE app.actual_outcome (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL,
    project_id UUID NOT NULL,
    approved_quotation_id UUID,
    total_revenue NUMERIC(19, 2) NOT NULL CHECK (total_revenue >= 0),
    actual_cost NUMERIC(19, 2) NOT NULL CHECK (actual_cost >= 0),
    actual_hours NUMERIC(19, 2) NOT NULL CHECK (actual_hours >= 0),
    profit_amount NUMERIC(19, 2) NOT NULL,
    profit_margin NUMERIC(9, 6),
    completed_on DATE,
    change_reason VARCHAR(5000),
    created_by UUID NOT NULL REFERENCES app.user_account(id),
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT fk_outcome_project_scope FOREIGN KEY (workspace_id, project_id)
        REFERENCES app.project(workspace_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_outcome_quotation_scope FOREIGN KEY (workspace_id, approved_quotation_id)
        REFERENCES app.quotation(workspace_id, id),
    CONSTRAINT uq_outcome_project UNIQUE (project_id),
    CONSTRAINT uq_outcome_workspace_id UNIQUE (workspace_id, id)
);

CREATE TABLE app.actual_work_item (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL,
    outcome_id UUID NOT NULL,
    quotation_item_id UUID,
    title VARCHAR(200) NOT NULL,
    actual_hours NUMERIC(19, 2) NOT NULL CHECK (actual_hours >= 0),
    actual_cost NUMERIC(19, 2) NOT NULL CHECK (actual_cost >= 0),
    notes VARCHAR(3000),
    sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
    created_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT fk_work_item_outcome_scope FOREIGN KEY (workspace_id, outcome_id)
        REFERENCES app.actual_outcome(workspace_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_work_item_quotation_scope FOREIGN KEY (workspace_id, quotation_item_id)
        REFERENCES app.quotation_item(workspace_id, id)
);

CREATE INDEX ix_outcome_workspace_completed ON app.actual_outcome(workspace_id, completed_on DESC);
CREATE INDEX ix_actual_work_item_outcome ON app.actual_work_item(workspace_id, outcome_id, sort_order);
