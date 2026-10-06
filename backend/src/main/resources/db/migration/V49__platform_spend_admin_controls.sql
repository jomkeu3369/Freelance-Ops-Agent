-- Administrative edits affect only future admission. Preserve every configured USD
-- amount, enabled flag, reservation, tariff, usage counter and deployment switch.
ALTER TABLE app.platform_spend_settings
    ADD COLUMN revision BIGINT NOT NULL DEFAULT 0 CHECK (revision >= 0),
    ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- A zero model cap explicitly stops new platform-funded runs. Existing immutable
-- reservations still require a positive cap and retain their original amount.
ALTER TABLE app.platform_spend_model_cap DROP CONSTRAINT platform_spend_model_cap_max_run_usd_check;
ALTER TABLE app.platform_spend_model_cap ADD CONSTRAINT platform_spend_model_cap_max_run_usd_check
    CHECK (max_run_usd >= 0 AND max_run_usd <= 100);

CREATE TABLE app.platform_spend_admin_audit (
    id UUID PRIMARY KEY,
    actor_user_id UUID NOT NULL,
    action VARCHAR(20) NOT NULL CHECK (action IN ('CHANGE_BUDGETS', 'CHANGE_MODEL')),
    target VARCHAR(140) NOT NULL,
    previous_value TEXT NOT NULL,
    new_value TEXT NOT NULL,
    previous_revision BIGINT NOT NULL CHECK (previous_revision >= 0),
    new_revision BIGINT NOT NULL CHECK (new_revision > previous_revision),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX ix_platform_spend_admin_audit_time ON app.platform_spend_admin_audit(created_at DESC,id DESC);
CREATE TRIGGER platform_spend_admin_audit_immutable
    BEFORE UPDATE OR DELETE ON app.platform_spend_admin_audit
    FOR EACH ROW EXECUTE FUNCTION app.reject_free_usage_audit_mutation();
