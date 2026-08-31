CREATE TABLE app.agent_task (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL,
    run_id UUID NOT NULL,
    parent_task_id UUID,
    department VARCHAR(32) NOT NULL,
    specialist_profile VARCHAR(100) NOT NULL,
    alias VARCHAR(100) NOT NULL,
    objective_reference VARCHAR(200) NOT NULL,
    status VARCHAR(32) NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
    priority INTEGER NOT NULL CHECK (priority BETWEEN 1 AND 5),
    deadline_at TIMESTAMPTZ,
    current_attempt_number INTEGER NOT NULL DEFAULT 0 CHECK (current_attempt_number >= 0),
    last_heartbeat_at TIMESTAMPTZ,
    phase VARCHAR(100),
    activity VARCHAR(300),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT fk_agent_task_run_scope FOREIGN KEY (workspace_id, run_id)
        REFERENCES app.agent_run(workspace_id, id) ON DELETE CASCADE,
    CONSTRAINT ck_agent_task_status CHECK (status IN (
        'QUEUED','DISPATCHED','RUNNING','WAITING_FOR_TOOL','WAITING_FOR_USER','UPDATE_PENDING',
        'CANCELLING','CANCELLED','COMPLETED','COMPLETED_REUSED','FAILED','TIMED_OUT'
    )),
    CONSTRAINT uq_agent_task_workspace_id UNIQUE (workspace_id, id),
    CONSTRAINT uq_agent_task_run_alias UNIQUE (run_id, alias),
    CONSTRAINT ck_agent_task_parent_not_self CHECK (parent_task_id IS NULL OR parent_task_id <> id),
    CONSTRAINT fk_agent_task_parent_scope FOREIGN KEY (workspace_id, parent_task_id)
        REFERENCES app.agent_task(workspace_id, id) ON DELETE CASCADE
);

CREATE INDEX ix_agent_task_workspace_status_priority
    ON app.agent_task(workspace_id, status, priority DESC, created_at);
CREATE INDEX ix_agent_task_run_status
    ON app.agent_task(run_id, status, created_at);

CREATE TABLE app.agent_task_dependency (
    task_id UUID NOT NULL,
    depends_on_task_id UUID NOT NULL,
    dependency_type VARCHAR(20) NOT NULL DEFAULT 'COMPLETION',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (task_id, depends_on_task_id),
    CONSTRAINT fk_agent_task_dependency_task FOREIGN KEY (task_id)
        REFERENCES app.agent_task(id) ON DELETE CASCADE,
    CONSTRAINT fk_agent_task_dependency_depends_on FOREIGN KEY (depends_on_task_id)
        REFERENCES app.agent_task(id) ON DELETE CASCADE,
    CONSTRAINT ck_agent_task_dependency_not_self CHECK (task_id <> depends_on_task_id),
    CONSTRAINT ck_agent_task_dependency_type CHECK (dependency_type IN ('COMPLETION','SUCCESS'))
);

CREATE INDEX ix_agent_task_dependency_depends_on
    ON app.agent_task_dependency(depends_on_task_id, task_id);

CREATE TABLE app.agent_task_attempt (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL,
    task_id UUID NOT NULL,
    task_revision INTEGER NOT NULL CHECK (task_revision >= 1),
    attempt_number INTEGER NOT NULL CHECK (attempt_number >= 1),
    status VARCHAR(32) NOT NULL,
    queued_at TIMESTAMPTZ NOT NULL,
    lease_owner VARCHAR(100),
    lease_until TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    predicted_service_runtime_seconds DOUBLE PRECISION,
    prediction_model_version VARCHAR(100),
    prediction_feature_snapshot JSONB,
    cache_outcome VARCHAR(30),
    failure_code VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT fk_agent_task_attempt_scope FOREIGN KEY (workspace_id, task_id)
        REFERENCES app.agent_task(workspace_id, id) ON DELETE CASCADE,
    CONSTRAINT uq_agent_task_attempt_number UNIQUE (task_id, task_revision, attempt_number),
    CONSTRAINT ck_agent_task_attempt_status CHECK (status IN (
        'QUEUED','LEASED','RUNNING','CHECKPOINTED','COMPLETED','FAILED','CANCELLED','TIMED_OUT','SUPERSEDED'
    )),
    CONSTRAINT ck_agent_task_attempt_prediction CHECK (
        (predicted_service_runtime_seconds IS NULL AND prediction_model_version IS NULL)
        OR (predicted_service_runtime_seconds >= 0 AND prediction_model_version IS NOT NULL)
    ),
    CONSTRAINT ck_agent_task_attempt_lease CHECK (
        (status = 'LEASED' AND lease_owner IS NOT NULL AND lease_until IS NOT NULL)
        OR (status <> 'LEASED')
    ),
    CONSTRAINT ck_agent_task_attempt_time_order CHECK (
        (started_at IS NULL OR queued_at <= started_at)
        AND (completed_at IS NULL OR started_at IS NOT NULL AND started_at <= completed_at)
    )
);

CREATE INDEX ix_agent_task_attempt_dispatch
    ON app.agent_task_attempt(status, queued_at, lease_until);
CREATE INDEX ix_agent_task_attempt_task_revision
    ON app.agent_task_attempt(task_id, task_revision, attempt_number DESC);
