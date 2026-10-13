-- A run binds to the project revision at admission. Legacy runs deliberately
-- remain unbound and cannot silently become a newly confirmed work product.
ALTER TABLE app.agent_run ADD COLUMN source_project_version BIGINT;
ALTER TABLE app.agent_run ADD COLUMN workflow_mode VARCHAR(30);
ALTER TABLE app.agent_run ADD CONSTRAINT ck_agent_run_workflow_mode
    CHECK (workflow_mode IS NULL OR workflow_mode IN ('PROJECT_ANALYSIS', 'AD_HOC'));
ALTER TABLE app.agent_run ADD CONSTRAINT uq_agent_run_project_scope
    UNIQUE (workspace_id, project_id, id);

CREATE INDEX ix_agent_run_analysis_source ON app.agent_run
    (workspace_id, project_id, created_at DESC) WHERE workflow_mode = 'PROJECT_ANALYSIS';

CREATE TABLE app.analysis_decision (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL,
    project_id UUID NOT NULL,
    family_id UUID NOT NULL,
    previous_id UUID,
    version_number INTEGER NOT NULL CHECK (version_number > 0),
    status VARCHAR(20) NOT NULL CHECK (status IN ('DRAFT', 'CONFIRMED')),
    source_run_id UUID NOT NULL,
    source_project_version BIGINT NOT NULL CHECK (source_project_version >= 0),
    selected_opinion_ids JSONB NOT NULL,
    source_opinions JSONB NOT NULL,
    source_pet_profiles JSONB NOT NULL,
    source_summary TEXT NOT NULL,
    source_open_questions JSONB NOT NULL,
    review_warnings JSONB NOT NULL,
    original_body_text TEXT NOT NULL,
    body_text TEXT NOT NULL CHECK (length(body_text) BETWEEN 1 AND 100000),
    content_hash VARCHAR(64) NOT NULL,
    body_origin VARCHAR(30) NOT NULL CHECK (body_origin IN ('SELECTED_OPINIONS', 'USER_EDITED')),
    request_id UUID NOT NULL,
    operation_hash VARCHAR(64) NOT NULL,
    created_by UUID NOT NULL REFERENCES app.user_account(id),
    created_at TIMESTAMPTZ NOT NULL,
    confirmed_by UUID REFERENCES app.user_account(id),
    confirmed_at TIMESTAMPTZ,
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT ck_analysis_confirmation CHECK (
        (status = 'DRAFT' AND confirmed_by IS NULL AND confirmed_at IS NULL)
        OR (status = 'CONFIRMED' AND confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL)
    ),
    CONSTRAINT fk_analysis_project_scope FOREIGN KEY (workspace_id, project_id)
        REFERENCES app.project(workspace_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_analysis_run_scope FOREIGN KEY (workspace_id, project_id, source_run_id)
        REFERENCES app.agent_run(workspace_id, project_id, id) ON DELETE CASCADE,
    CONSTRAINT uq_analysis_revision UNIQUE (workspace_id, project_id, family_id, version_number),
    CONSTRAINT uq_analysis_request UNIQUE (workspace_id, project_id, created_by, request_id),
    CONSTRAINT uq_analysis_project_scope UNIQUE (workspace_id, project_id, id),
    CONSTRAINT fk_analysis_previous_scope FOREIGN KEY (workspace_id, project_id, previous_id)
        REFERENCES app.analysis_decision(workspace_id, project_id, id)
);

CREATE INDEX ix_analysis_project_history ON app.analysis_decision
    (workspace_id, project_id, created_at DESC, id DESC);
