CREATE TABLE app.model_pricing (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES app.workspace(id) ON DELETE CASCADE,
    provider VARCHAR(20) NOT NULL CHECK (provider IN ('OPENAI', 'GEMINI')),
    model VARCHAR(100) NOT NULL,
    version_label VARCHAR(100) NOT NULL,
    currency CHAR(3) NOT NULL,
    input_per_million NUMERIC(19, 8) NOT NULL CHECK (input_per_million >= 0),
    cached_input_per_million NUMERIC(19, 8) NOT NULL CHECK (cached_input_per_million >= 0),
    output_per_million NUMERIC(19, 8) NOT NULL CHECK (output_per_million >= 0),
    valid_from TIMESTAMPTZ NOT NULL,
    valid_until TIMESTAMPTZ,
    created_by UUID NOT NULL REFERENCES app.user_account(id),
    created_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT uq_model_pricing_workspace_id UNIQUE (workspace_id, id),
    CONSTRAINT uq_model_pricing_version UNIQUE (workspace_id, provider, model, version_label),
    CONSTRAINT ck_model_pricing_validity CHECK (valid_until IS NULL OR valid_until > valid_from)
);

CREATE INDEX ix_model_pricing_lookup
    ON app.model_pricing(workspace_id, provider, model, valid_from DESC);

CREATE TABLE app.agent_run_usage (
    agent_run_id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL,
    pricing_snapshot_id UUID,
    request_tier VARCHAR(30) NOT NULL CHECK (
        request_tier IN ('DIRECT_TOOL', 'SINGLE_AGENT', 'DEPARTMENT', 'MULTI_DEPARTMENT', 'HUMAN_REQUIRED')
    ),
    model_calls BIGINT NOT NULL CHECK (model_calls >= 0),
    tool_calls BIGINT NOT NULL CHECK (tool_calls >= 0),
    input_tokens BIGINT NOT NULL CHECK (input_tokens >= 0),
    output_tokens BIGINT NOT NULL CHECK (output_tokens >= 0),
    cached_tokens BIGINT NOT NULL CHECK (cached_tokens >= 0 AND cached_tokens <= input_tokens),
    search_credits BIGINT NOT NULL CHECK (search_credits >= 0),
    crawled_pages BIGINT NOT NULL CHECK (crawled_pages >= 0),
    retry_count BIGINT NOT NULL CHECK (retry_count >= 0),
    duration_ms BIGINT NOT NULL CHECK (duration_ms >= 0),
    actual_cost NUMERIC(19, 8),
    cost_currency CHAR(3),
    cost_status VARCHAR(20) NOT NULL CHECK (cost_status IN ('PRICED', 'UNPRICED')),
    billable_outcome BOOLEAN NOT NULL DEFAULT FALSE,
    recorded_at TIMESTAMPTZ NOT NULL,
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT fk_agent_run_usage_run_scope
        FOREIGN KEY (workspace_id, agent_run_id)
        REFERENCES app.agent_run(workspace_id, id)
        ON DELETE CASCADE,
    CONSTRAINT fk_agent_run_usage_pricing_scope
        FOREIGN KEY (workspace_id, pricing_snapshot_id)
        REFERENCES app.model_pricing(workspace_id, id),
    CONSTRAINT ck_agent_run_usage_cost CHECK (
        (cost_status = 'PRICED' AND pricing_snapshot_id IS NOT NULL AND actual_cost IS NOT NULL AND cost_currency IS NOT NULL)
        OR
        (cost_status = 'UNPRICED' AND pricing_snapshot_id IS NULL AND actual_cost IS NULL AND cost_currency IS NULL)
    )
);

CREATE INDEX ix_agent_run_usage_workspace_recorded
    ON app.agent_run_usage(workspace_id, recorded_at DESC);
