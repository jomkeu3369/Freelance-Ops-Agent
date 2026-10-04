-- Account-wide admission ledger. Project/workspace deletion must not replenish quota.
CREATE TABLE app.free_usage_settings (
    id SMALLINT PRIMARY KEY CHECK (id = 1),
    monthly_limit INTEGER NOT NULL CHECK (monthly_limit BETWEEN 0 AND 100),
    epoch BIGINT NOT NULL DEFAULT 0 CHECK (epoch >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_reset_at TIMESTAMPTZ
);
INSERT INTO app.free_usage_settings (id, monthly_limit) VALUES (1, 5);

-- Intentionally empty. Workspace OWNER/ADMIN never implies platform authority.
-- Grants are provisioned separately by an authorized operator for a verified account.
CREATE TABLE app.platform_admin_grant (
    user_id UUID PRIMARY KEY REFERENCES app.user_account(id) ON DELETE CASCADE,
    capability VARCHAR(40) NOT NULL CHECK (capability = 'FREE_USAGE_ADMIN'),
    granted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    revoked_at TIMESTAMPTZ
);

CREATE TABLE app.free_usage_bucket (
    user_id UUID NOT NULL REFERENCES app.user_account(id) ON DELETE CASCADE,
    period DATE NOT NULL CHECK (EXTRACT(DAY FROM period) = 1),
    epoch BIGINT NOT NULL CHECK (epoch >= 0),
    used INTEGER NOT NULL DEFAULT 0 CHECK (used >= 0),
    reserved INTEGER NOT NULL DEFAULT 0 CHECK (reserved >= 0),
    PRIMARY KEY (user_id, period, epoch)
);
CREATE TABLE app.free_usage_reservation (
    run_id UUID PRIMARY KEY,
    user_id UUID NOT NULL,
    period DATE NOT NULL,
    epoch BIGINT NOT NULL,
    status VARCHAR(12) NOT NULL CHECK (status IN ('RESERVED', 'CONSUMED', 'RELEASED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    settled_at TIMESTAMPTZ,
    FOREIGN KEY (user_id, period, epoch) REFERENCES app.free_usage_bucket(user_id, period, epoch) ON DELETE CASCADE,
    CHECK ((status = 'RESERVED' AND settled_at IS NULL) OR (status <> 'RESERVED' AND settled_at IS NOT NULL))
);
CREATE INDEX ix_free_usage_reservation_bucket ON app.free_usage_reservation (user_id, period, epoch);

-- Shared by platform and personal-key runs; survives project deletion and global resets.
CREATE TABLE app.agent_start_idempotency (
    user_id UUID NOT NULL REFERENCES app.user_account(id) ON DELETE CASCADE,
    idempotency_key VARCHAR(128) NOT NULL,
    request_hash CHAR(64) NOT NULL,
    run_id UUID NOT NULL UNIQUE,
    accepted_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (user_id, idempotency_key)
);
CREATE TABLE app.free_usage_admin_audit (
    id UUID PRIMARY KEY,
    actor_user_id UUID NOT NULL,
    action VARCHAR(20) NOT NULL CHECK (action IN ('CHANGE_LIMIT', 'RESET_ALL')),
    previous_limit INTEGER NOT NULL,
    new_limit INTEGER NOT NULL,
    previous_epoch BIGINT NOT NULL,
    new_epoch BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE FUNCTION app.reject_free_usage_audit_mutation() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'free usage administrator audit is immutable';
END;
$$;
CREATE TRIGGER free_usage_admin_audit_immutable
    BEFORE UPDATE OR DELETE ON app.free_usage_admin_audit
    FOR EACH ROW EXECUTE FUNCTION app.reject_free_usage_audit_mutation();
