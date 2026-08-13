CREATE TABLE app.requirement_version (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL,
    project_id UUID NOT NULL,
    version_number INTEGER NOT NULL CHECK (version_number > 0),
    source_text VARCHAR(50000) NOT NULL,
    created_by UUID NOT NULL REFERENCES app.user_account(id),
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT fk_requirement_project_scope FOREIGN KEY (workspace_id, project_id)
        REFERENCES app.project(workspace_id, id) ON DELETE CASCADE,
    CONSTRAINT uq_requirement_project_version UNIQUE (project_id, version_number),
    CONSTRAINT uq_requirement_workspace_id UNIQUE (workspace_id, id)
);

CREATE TABLE app.requirement_feature (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL,
    requirement_version_id UUID NOT NULL,
    title VARCHAR(200) NOT NULL,
    description VARCHAR(5000) NOT NULL,
    priority VARCHAR(20) NOT NULL CHECK (priority IN ('MUST', 'SHOULD', 'COULD', 'WONT')),
    acceptance_criteria VARCHAR(5000),
    sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
    created_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT fk_requirement_feature_scope FOREIGN KEY (workspace_id, requirement_version_id)
        REFERENCES app.requirement_version(workspace_id, id) ON DELETE CASCADE
);

CREATE TABLE app.requirement_assumption (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL,
    requirement_version_id UUID NOT NULL,
    content VARCHAR(3000) NOT NULL,
    sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
    created_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT fk_requirement_assumption_scope FOREIGN KEY (workspace_id, requirement_version_id)
        REFERENCES app.requirement_version(workspace_id, id) ON DELETE CASCADE
);

CREATE TABLE app.requirement_question (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL,
    requirement_version_id UUID NOT NULL,
    content VARCHAR(3000) NOT NULL,
    status VARCHAR(20) NOT NULL CHECK (status IN ('OPEN', 'ANSWERED', 'DISMISSED')),
    sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
    created_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT fk_requirement_question_scope FOREIGN KEY (workspace_id, requirement_version_id)
        REFERENCES app.requirement_version(workspace_id, id) ON DELETE CASCADE
);

CREATE INDEX ix_requirement_project_created ON app.requirement_version(workspace_id, project_id, version_number DESC);
CREATE INDEX ix_requirement_feature_version ON app.requirement_feature(workspace_id, requirement_version_id, sort_order);
CREATE INDEX ix_requirement_assumption_version ON app.requirement_assumption(workspace_id, requirement_version_id, sort_order);
CREATE INDEX ix_requirement_question_version ON app.requirement_question(workspace_id, requirement_version_id, sort_order);
