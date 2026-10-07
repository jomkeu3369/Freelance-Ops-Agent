-- USD precision is authoritative; percentages are display-only. Old reservations
-- retain their conservative exposure. There is no budget increase or free reset.
CREATE TABLE app.platform_spend_settlement (
    run_id UUID PRIMARY KEY REFERENCES app.platform_spend_reservation(run_id),
    settled_usd NUMERIC(19,8) NOT NULL DEFAULT 0 CHECK (settled_usd >= 0),
    reserved_usd NUMERIC(19,8) NOT NULL CHECK (reserved_usd >= 0),
    execution_closed BOOLEAN NOT NULL DEFAULT FALSE,
    observed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO app.platform_spend_settlement(run_id, reserved_usd)
SELECT run_id, max_cost_usd FROM app.platform_spend_reservation;
CREATE TABLE app.platform_provider_attempt (
    call_id UUID PRIMARY KEY,
    run_id UUID NOT NULL REFERENCES app.platform_spend_reservation(run_id),
    payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX ix_platform_attempt_run ON app.platform_provider_attempt(run_id);
-- Deleting an account/workspace/run cannot refund real or unknown API spend.
CREATE TRIGGER platform_spend_settlement_no_delete BEFORE DELETE ON app.platform_spend_settlement
    FOR EACH ROW EXECUTE FUNCTION app.reject_platform_spend_reservation_mutation();
CREATE TRIGGER platform_provider_attempt_no_delete BEFORE DELETE ON app.platform_provider_attempt
    FOR EACH ROW EXECUTE FUNCTION app.reject_platform_spend_reservation_mutation();
