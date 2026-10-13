-- Additive, inactive policy scaffolding. No operator limits are increased and no
-- provider is enabled. Explicit rollout and configured monthly limits are required.
ALTER TABLE app.platform_spend_settings
    ADD COLUMN completion_required BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN global_month_soft_usd NUMERIC(19,8) NOT NULL DEFAULT 0 CHECK (global_month_soft_usd >= 0),
    ADD COLUMN global_month_hard_usd NUMERIC(19,8) NOT NULL DEFAULT 0 CHECK (global_month_hard_usd >= global_month_soft_usd),
    ADD COLUMN completion_policy_revision BIGINT NOT NULL DEFAULT 1 CHECK (completion_policy_revision >= 1),
    ADD COLUMN completion_router_models TEXT[] NOT NULL DEFAULT ARRAY['gpt-5.6-luna']::text[];

CREATE FUNCTION app.version_completion_spend_policy() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.completion_policy_revision := OLD.completion_policy_revision;
    IF (NEW.completion_required, NEW.global_month_soft_usd, NEW.global_month_hard_usd, NEW.completion_router_models)
        IS DISTINCT FROM (OLD.completion_required, OLD.global_month_soft_usd, OLD.global_month_hard_usd, OLD.completion_router_models) THEN
        NEW.completion_policy_revision := OLD.completion_policy_revision + 1;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER completion_spend_policy_revision BEFORE UPDATE ON app.platform_spend_settings
    FOR EACH ROW EXECUTE FUNCTION app.version_completion_spend_policy();

-- Keep the original reservation immutable, including its historical deadline.
-- This child pins the full aggregate budget and every priceable platform model.
CREATE TABLE app.platform_completion_reservation (
    run_id UUID PRIMARY KEY REFERENCES app.platform_spend_reservation(run_id),
    payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object')
);
CREATE TRIGGER platform_completion_reservation_immutable BEFORE UPDATE OR DELETE
    ON app.platform_completion_reservation FOR EACH ROW EXECUTE FUNCTION app.reject_platform_spend_reservation_mutation();

-- Month rows are separate from daily/weekly buckets. Carry is conservative and
-- monotonic within a month: a late previous-period settlement cannot buy new work.
CREATE TABLE app.platform_spend_month_entry (
    run_id UUID NOT NULL REFERENCES app.platform_spend_reservation(run_id),
    month_period DATE NOT NULL CHECK (EXTRACT(DAY FROM month_period) = 1),
    exposure_usd NUMERIC(19,8) NOT NULL CHECK (exposure_usd >= 0),
    carried BOOLEAN NOT NULL,
    PRIMARY KEY (run_id, month_period)
);
CREATE INDEX ix_platform_spend_month ON app.platform_spend_month_entry(month_period);
CREATE TRIGGER platform_spend_month_no_delete BEFORE DELETE ON app.platform_spend_month_entry
    FOR EACH ROW EXECUTE FUNCTION app.reject_platform_spend_reservation_mutation();

-- Admission protocol fence survives a rolling deploy or rollback to an old binary.
-- Deferred because the immutable child is inserted after its immutable parent.
CREATE FUNCTION app.require_completion_reservation() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE required BOOLEAN;
BEGIN
    SELECT completion_required INTO required FROM app.platform_spend_settings WHERE id=1 FOR UPDATE;
    IF required AND NOT EXISTS (SELECT 1 FROM app.platform_completion_reservation WHERE run_id=NEW.run_id) THEN
        RAISE EXCEPTION 'Completion reservation protocol is required';
    END IF;
    RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER platform_completion_admission_fence
    AFTER INSERT ON app.platform_spend_reservation DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION app.require_completion_reservation();

-- Capture carry at settlement time as well as admission time. An older backend
-- can settle an old run before the first new-month admission; that cannot erase
-- exposure that may have been incurred after the month boundary.
CREATE FUNCTION app.capture_platform_month_settlement() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE month_start DATE; admission_day DATE; cap NUMERIC(19,8); liability NUMERIC(19,8); increase NUMERIC(19,8);
BEGIN
    PERFORM id FROM app.platform_spend_settings WHERE id=1 FOR UPDATE;
    month_start := date_trunc('month',clock_timestamp() AT TIME ZONE 'Asia/Seoul')::date;
    SELECT day_period,max_cost_usd INTO admission_day,cap FROM app.platform_spend_reservation WHERE run_id=NEW.run_id;
    IF admission_day >= month_start AND admission_day < (month_start + INTERVAL '1 month') THEN
        INSERT INTO app.platform_spend_month_entry(run_id,month_period,exposure_usd,carried)
            VALUES (NEW.run_id,month_start,NEW.settled_usd+NEW.reserved_usd,FALSE)
        ON CONFLICT(run_id,month_period) DO UPDATE SET exposure_usd=EXCLUDED.exposure_usd
            WHERE NOT platform_spend_month_entry.carried;
    ELSIF admission_day < month_start AND TG_OP = 'UPDATE' THEN
        liability := CASE WHEN OLD.execution_closed THEN OLD.reserved_usd
            ELSE GREATEST(cap,OLD.settled_usd+OLD.reserved_usd) END;
        IF liability > 0 THEN
            INSERT INTO app.platform_spend_month_entry(run_id,month_period,exposure_usd,carried)
                VALUES (NEW.run_id,month_start,liability,TRUE)
            ON CONFLICT(run_id,month_period) DO UPDATE SET
                exposure_usd=GREATEST(platform_spend_month_entry.exposure_usd,EXCLUDED.exposure_usd);
        END IF;
        increase := GREATEST(0,NEW.settled_usd+NEW.reserved_usd-OLD.settled_usd-OLD.reserved_usd);
        IF increase > 0 THEN
            INSERT INTO app.platform_spend_month_entry(run_id,month_period,exposure_usd,carried)
                VALUES (NEW.run_id,month_start,increase,TRUE)
            ON CONFLICT(run_id,month_period) DO UPDATE SET
                exposure_usd=platform_spend_month_entry.exposure_usd+EXCLUDED.exposure_usd;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER platform_month_settlement_capture AFTER INSERT OR UPDATE ON app.platform_spend_settlement
    FOR EACH ROW EXECUTE FUNCTION app.capture_platform_month_settlement();

CREATE FUNCTION app.reject_platform_month_regression() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF (NEW.run_id,NEW.month_period,NEW.carried) IS DISTINCT FROM (OLD.run_id,OLD.month_period,OLD.carried)
        OR (OLD.carried AND NEW.exposure_usd < OLD.exposure_usd) THEN
        RAISE EXCEPTION 'Platform monthly carry identity and retained exposure are immutable';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER platform_month_no_regression BEFORE UPDATE ON app.platform_spend_month_entry
    FOR EACH ROW EXECUTE FUNCTION app.reject_platform_month_regression();
