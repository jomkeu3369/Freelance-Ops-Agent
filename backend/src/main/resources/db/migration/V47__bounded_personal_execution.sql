-- BYOK authorizes only the selected personal credential. It never touches platform USD buckets.
-- Kept independent of deletable run/account rows so deletion cannot erase admitted attempts.
CREATE TABLE app.byok_execution_scope (
    scope_id UUID PRIMARY KEY,
    run_id UUID NOT NULL UNIQUE,
    payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
    valid_until TIMESTAMPTZ NOT NULL,
    max_model_calls INTEGER NOT NULL CHECK (max_model_calls BETWEEN 0 AND 50),
    max_input_tokens INTEGER NOT NULL CHECK (max_input_tokens >= 0),
    max_output_tokens INTEGER NOT NULL CHECK (max_output_tokens >= 0),
    model_calls INTEGER NOT NULL DEFAULT 0 CHECK (model_calls BETWEEN 0 AND max_model_calls),
    input_tokens BIGINT NOT NULL DEFAULT 0 CHECK (input_tokens BETWEEN 0 AND max_input_tokens),
    output_tokens BIGINT NOT NULL DEFAULT 0 CHECK (output_tokens BETWEEN 0 AND max_output_tokens),
    closed BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE app.byok_provider_attempt (
    call_id UUID PRIMARY KEY,
    scope_id UUID NOT NULL REFERENCES app.byok_execution_scope(scope_id),
    operation VARCHAR(40) NOT NULL CHECK (operation IN ('department_work_product','bounded_react_step')),
    input_tokens INTEGER NOT NULL CHECK (input_tokens > 0),
    output_tokens INTEGER NOT NULL CHECK (output_tokens > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX ix_byok_attempt_scope ON app.byok_provider_attempt(scope_id);
CREATE FUNCTION app.guard_byok_scope_mutation() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Personal execution limits cannot be deleted'; END IF;
    IF NEW.scope_id IS DISTINCT FROM OLD.scope_id OR NEW.run_id IS DISTINCT FROM OLD.run_id
       OR NEW.payload IS DISTINCT FROM OLD.payload OR NEW.valid_until IS DISTINCT FROM OLD.valid_until
       OR NEW.max_model_calls IS DISTINCT FROM OLD.max_model_calls
       OR NEW.max_input_tokens IS DISTINCT FROM OLD.max_input_tokens
       OR NEW.max_output_tokens IS DISTINCT FROM OLD.max_output_tokens
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.model_calls < OLD.model_calls OR NEW.input_tokens < OLD.input_tokens
       OR NEW.output_tokens < OLD.output_tokens OR (OLD.closed AND NOT NEW.closed) THEN
        RAISE EXCEPTION 'Personal execution limits are immutable and consumption is monotone';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER byok_scope_monotone BEFORE UPDATE OR DELETE ON app.byok_execution_scope
    FOR EACH ROW EXECUTE FUNCTION app.guard_byok_scope_mutation();
CREATE TRIGGER byok_attempt_immutable BEFORE UPDATE OR DELETE ON app.byok_provider_attempt
    FOR EACH ROW EXECUTE FUNCTION app.reject_platform_spend_reservation_mutation();
ALTER TABLE app.agent_run_usage ADD COLUMN byok_scope_id UUID REFERENCES app.byok_execution_scope(scope_id);
ALTER TABLE app.agent_run_usage DROP CONSTRAINT ck_agent_run_usage_cost;
ALTER TABLE app.agent_run_usage ADD CONSTRAINT ck_agent_run_usage_cost CHECK (
    (byok_scope_id IS NOT NULL AND platform_reservation_id IS NULL AND tariff_version IS NULL
        AND platform_cost_usd = 0 AND pricing_snapshot_id IS NULL AND actual_cost IS NULL
        AND cost_currency IS NULL AND cost_status = 'UNPRICED')
    OR (byok_scope_id IS NULL AND platform_reservation_id IS NULL AND tariff_version IS NULL AND platform_cost_usd IS NULL AND (
        (cost_status = 'PRICED' AND pricing_snapshot_id IS NOT NULL AND actual_cost IS NOT NULL AND cost_currency IS NOT NULL)
        OR (cost_status = 'UNPRICED' AND pricing_snapshot_id IS NULL AND actual_cost IS NULL AND cost_currency IS NULL)))
    OR (byok_scope_id IS NULL AND platform_reservation_id IS NOT NULL AND platform_reservation_id = agent_run_id
        AND tariff_version IS NOT NULL AND length(tariff_version) > 0 AND pricing_snapshot_id IS NULL
        AND cost_currency IS NOT NULL AND cost_currency = 'USD'
        AND (platform_cost_usd IS NULL OR platform_cost_usd >= 0) AND (
            (cost_status = 'PRICED' AND actual_cost IS NOT NULL AND actual_cost >= 0 AND platform_cost_usd IS NOT NULL)
            OR (cost_status = 'UNPRICED' AND actual_cost IS NULL)))
);
