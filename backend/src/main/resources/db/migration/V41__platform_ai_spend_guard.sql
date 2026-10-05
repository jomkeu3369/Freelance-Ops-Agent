-- Development planning values only. Application spending is disabled unless an operator
-- explicitly enables platform.ai.spend.enabled; this migration never invokes providers.
-- Settings have no user-facing mutation endpoint, and are independent from product-credit resets.
CREATE TABLE app.platform_spend_settings (
    id SMALLINT PRIMARY KEY CHECK (id = 1),
    luna_run_usd NUMERIC(19,8) NOT NULL CHECK (luna_run_usd > 0 AND luna_run_usd <= 100),
    terra_run_usd NUMERIC(19,8) NOT NULL CHECK (terra_run_usd > 0 AND terra_run_usd <= 100),
    account_week_usd NUMERIC(19,8) NOT NULL CHECK (account_week_usd >= 0),
    global_day_usd NUMERIC(19,8) NOT NULL CHECK (global_day_usd >= 0),
    global_week_usd NUMERIC(19,8) NOT NULL CHECK (global_week_usd >= 0)
);
INSERT INTO app.platform_spend_settings VALUES (1, 0.10, 1.00, 1.25, 25.00, 100.00);

CREATE TABLE app.platform_spend_bucket (
    scope VARCHAR(20) NOT NULL CHECK (scope IN ('GLOBAL_DAY', 'GLOBAL_WEEK', 'ACCOUNT_WEEK')),
    subject_id UUID NOT NULL,
    period DATE NOT NULL,
    held_usd NUMERIC(19,8) NOT NULL DEFAULT 0 CHECK (held_usd >= 0),
    PRIMARY KEY (scope, subject_id, period)
);
-- Intentionally no run, user or workspace foreign key: deleting these never replenishes money.
CREATE TABLE app.platform_spend_reservation (
    run_id UUID PRIMARY KEY,
    user_id UUID NOT NULL,
    provider VARCHAR(20) NOT NULL,
    model VARCHAR(100) NOT NULL,
    max_cost_usd NUMERIC(19,8) NOT NULL CHECK (max_cost_usd > 0),
    tariff_version VARCHAR(100) NOT NULL,
    day_period DATE NOT NULL,
    week_period DATE NOT NULL,
    valid_until TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX ix_platform_spend_user_week ON app.platform_spend_reservation(user_id, week_period);
CREATE FUNCTION app.reject_platform_spend_reservation_mutation() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Platform monetary reservations are immutable';
END;
$$;
CREATE TRIGGER platform_spend_reservation_immutable BEFORE UPDATE OR DELETE
    ON app.platform_spend_reservation FOR EACH ROW EXECUTE FUNCTION app.reject_platform_spend_reservation_mutation();

ALTER TABLE app.agent_run_usage ADD COLUMN provider_calls JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(provider_calls) = 'array');
ALTER TABLE app.agent_run_usage ADD COLUMN platform_cost_usd NUMERIC(19,8);
ALTER TABLE app.agent_run_usage ADD COLUMN platform_reservation_id UUID;
ALTER TABLE app.agent_run_usage ADD COLUMN tariff_version VARCHAR(100);

-- Preserve the old workspace-pricing invariant for historical rows. New platform
-- accounting identifies the immutable monetary reservation and pinned tariff instead
-- of a user-editable pricing snapshot. Unknown usage retains currency/exposure but no
-- invented actual cost; it never becomes a PRICED zero-dollar success.
ALTER TABLE app.agent_run_usage DROP CONSTRAINT ck_agent_run_usage_cost;
ALTER TABLE app.agent_run_usage ADD CONSTRAINT fk_agent_run_usage_platform_reservation
    FOREIGN KEY (platform_reservation_id) REFERENCES app.platform_spend_reservation(run_id);
ALTER TABLE app.agent_run_usage ADD CONSTRAINT ck_agent_run_usage_cost CHECK (
    (platform_reservation_id IS NULL AND tariff_version IS NULL AND platform_cost_usd IS NULL AND (
        (cost_status = 'PRICED' AND pricing_snapshot_id IS NOT NULL AND actual_cost IS NOT NULL AND cost_currency IS NOT NULL)
        OR (cost_status = 'UNPRICED' AND pricing_snapshot_id IS NULL AND actual_cost IS NULL AND cost_currency IS NULL)
    ))
    OR (platform_reservation_id IS NOT NULL AND platform_reservation_id = agent_run_id AND tariff_version IS NOT NULL AND length(tariff_version) > 0
        AND pricing_snapshot_id IS NULL AND cost_currency IS NOT NULL AND cost_currency = 'USD'
        AND (platform_cost_usd IS NULL OR platform_cost_usd >= 0) AND (
            (cost_status = 'PRICED' AND actual_cost IS NOT NULL AND actual_cost >= 0 AND platform_cost_usd IS NOT NULL)
            OR (cost_status = 'UNPRICED' AND actual_cost IS NULL)
        ))
);
