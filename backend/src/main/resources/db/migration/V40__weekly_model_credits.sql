-- Weekly customer credits are separate from historical monthly allowances and provider USD spend.
-- This migration provisions no administrator grants and never mutates an old reservation.
CREATE TABLE app.weekly_credit_settings (
    id SMALLINT PRIMARY KEY CHECK (id = 1),
    weekly_limit INTEGER NOT NULL CHECK (weekly_limit BETWEEN 0 AND 100000),
    epoch BIGINT NOT NULL DEFAULT 0 CHECK (epoch >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_reset_at TIMESTAMPTZ
);
INSERT INTO app.weekly_credit_settings (id, weekly_limit) VALUES (1, 100);
CREATE TABLE app.weekly_credit_model_rate (
    provider VARCHAR(20) NOT NULL CHECK (provider = 'OPENAI'),
    model VARCHAR(100) NOT NULL CHECK (model IN ('gpt-5.6-luna', 'gpt-5.6-terra')),
    credits INTEGER NOT NULL CHECK (credits BETWEEN 1 AND 100000),
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    PRIMARY KEY (provider, model)
);
INSERT INTO app.weekly_credit_model_rate (provider, model, credits) VALUES
    ('OPENAI', 'gpt-5.6-luna', 10), ('OPENAI', 'gpt-5.6-terra', 100);
CREATE TABLE app.weekly_credit_bucket (
    user_id UUID NOT NULL REFERENCES app.user_account(id) ON DELETE CASCADE,
    period DATE NOT NULL CHECK (EXTRACT(ISODOW FROM period) = 1),
    epoch BIGINT NOT NULL CHECK (epoch >= 0),
    used INTEGER NOT NULL DEFAULT 0 CHECK (used BETWEEN 0 AND 100000),
    reserved INTEGER NOT NULL DEFAULT 0 CHECK (reserved BETWEEN 0 AND 100000),
    CHECK (used + reserved <= 100000),
    PRIMARY KEY (user_id, period, epoch)
);
CREATE TABLE app.weekly_credit_reservation (
    run_id UUID PRIMARY KEY,
    user_id UUID NOT NULL,
    period DATE NOT NULL,
    epoch BIGINT NOT NULL,
    credits INTEGER NOT NULL CHECK (credits BETWEEN 1 AND 100000),
    provider VARCHAR(20) NOT NULL,
    model VARCHAR(100) NOT NULL,
    rate_version TIMESTAMPTZ NOT NULL,
    status VARCHAR(12) NOT NULL CHECK (status IN ('RESERVED', 'CONSUMED', 'RELEASED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    settled_at TIMESTAMPTZ,
    FOREIGN KEY (user_id, period, epoch) REFERENCES app.weekly_credit_bucket(user_id, period, epoch) ON DELETE CASCADE,
    CHECK ((status = 'RESERVED' AND settled_at IS NULL) OR (status <> 'RESERVED' AND settled_at IS NOT NULL))
);
CREATE INDEX ix_weekly_credit_reservation_bucket ON app.weekly_credit_reservation(user_id, period, epoch);
CREATE TABLE app.weekly_credit_admin_audit (
    id UUID PRIMARY KEY,
    actor_user_id UUID NOT NULL,
    action VARCHAR(20) NOT NULL CHECK (action IN ('CHANGE_LIMIT', 'CHANGE_MODEL', 'RESET_ALL')),
    target VARCHAR(160) NOT NULL,
    previous_value VARCHAR(160) NOT NULL,
    new_value VARCHAR(160) NOT NULL,
    previous_epoch BIGINT NOT NULL,
    new_epoch BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER weekly_credit_admin_audit_immutable BEFORE UPDATE OR DELETE ON app.weekly_credit_admin_audit
    FOR EACH ROW EXECUTE FUNCTION app.reject_free_usage_audit_mutation();
