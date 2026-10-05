-- Independent platform capability; no grant is created or expanded by this migration.
ALTER TABLE app.platform_admin_grant DROP CONSTRAINT platform_admin_grant_pkey;
ALTER TABLE app.platform_admin_grant DROP CONSTRAINT platform_admin_grant_capability_check;
ALTER TABLE app.platform_admin_grant ADD PRIMARY KEY (user_id, capability);
ALTER TABLE app.platform_admin_grant ADD CHECK (capability IN ('FREE_USAGE_ADMIN', 'NOTICES_ADMIN'));

CREATE TABLE app.service_notice (
    id UUID PRIMARY KEY,
    kind VARCHAR(24) NOT NULL CHECK (kind IN ('OPERATIONAL', 'TERMS_VERSION', 'PRIVACY_VERSION')),
    title VARCHAR(200) NOT NULL,
    body TEXT NOT NULL,
    version_label VARCHAR(80) NOT NULL,
    effective_at TIMESTAMPTZ NOT NULL,
    publish_at TIMESTAMPTZ,
    status VARCHAR(16) NOT NULL CHECK (status IN ('DRAFT', 'REVIEWED', 'PUBLISHED')),
    content_hash CHAR(64) NOT NULL,
    revision BIGINT NOT NULL DEFAULT 0,
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (kind, version_label),
    CHECK (kind = 'OPERATIONAL' OR (body = '' AND status <> 'PUBLISHED')),
    CHECK ((status = 'PUBLISHED') = (publish_at IS NOT NULL)),
    CHECK (publish_at IS NULL OR publish_at <= effective_at)
);
CREATE INDEX ix_notice_public ON app.service_notice(publish_at DESC) WHERE status = 'PUBLISHED';
CREATE TABLE app.notice_campaign (
    id UUID PRIMARY KEY,
    notice_id UUID NOT NULL REFERENCES app.service_notice(id),
    snapshot_title VARCHAR(200) NOT NULL,
    snapshot_body TEXT NOT NULL,
    snapshot_version_label VARCHAR(80) NOT NULL,
    content_hash CHAR(64) NOT NULL,
    recipient_hash CHAR(64) NOT NULL,
    recipient_count INTEGER NOT NULL CHECK (recipient_count >= 0),
    status VARCHAR(16) NOT NULL CHECK (status IN ('DRAFT', 'QUEUED', 'CANCELLED', 'COMPLETED')),
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    test_status VARCHAR(24),
    test_by UUID,
    tested_at TIMESTAMPTZ,
    test_count INTEGER NOT NULL DEFAULT 0,
    confirmed_by UUID,
    confirmed_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ
);
CREATE TABLE app.notice_delivery (
    id UUID PRIMARY KEY,
    campaign_id UUID NOT NULL REFERENCES app.notice_campaign(id),
    user_id UUID NOT NULL REFERENCES app.user_account(id) ON DELETE CASCADE,
    recipient_email VARCHAR(320) NOT NULL,
    status VARCHAR(16) NOT NULL CHECK (status IN ('PREPARED','QUEUED','ACCEPTED','RETRY','FAILED','UNKNOWN','BOUNCED','CANCELLED','SUPPRESSED')),
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ,
    last_result VARCHAR(24),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (campaign_id, user_id)
);
CREATE INDEX ix_notice_delivery_pending ON app.notice_delivery(campaign_id, next_attempt_at)
    WHERE status IN ('QUEUED', 'RETRY');
CREATE TABLE app.notice_admin_audit (
    id UUID PRIMARY KEY,
    actor_user_id UUID NOT NULL,
    notice_id UUID,
    campaign_id UUID,
    action VARCHAR(40) NOT NULL,
    content_hash CHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE FUNCTION app.protect_notice_content() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF (NEW.kind, NEW.title, NEW.body, NEW.version_label, NEW.effective_at, NEW.content_hash, NEW.created_by)
       IS DISTINCT FROM (OLD.kind, OLD.title, OLD.body, OLD.version_label, OLD.effective_at, OLD.content_hash, OLD.created_by)
       OR OLD.status = 'PUBLISHED' THEN
        RAISE EXCEPTION 'notice content is immutable; create a new version';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER notice_content_immutable BEFORE UPDATE ON app.service_notice
    FOR EACH ROW EXECUTE FUNCTION app.protect_notice_content();
CREATE FUNCTION app.protect_notice_campaign_snapshot() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF (NEW.notice_id, NEW.snapshot_title, NEW.snapshot_body, NEW.snapshot_version_label, NEW.content_hash,
        NEW.recipient_hash, NEW.recipient_count, NEW.created_by, NEW.created_at)
       IS DISTINCT FROM
       (OLD.notice_id, OLD.snapshot_title, OLD.snapshot_body, OLD.snapshot_version_label, OLD.content_hash,
        OLD.recipient_hash, OLD.recipient_count, OLD.created_by, OLD.created_at) THEN
        RAISE EXCEPTION 'campaign snapshot is immutable';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER notice_campaign_snapshot_immutable BEFORE UPDATE ON app.notice_campaign
    FOR EACH ROW EXECUTE FUNCTION app.protect_notice_campaign_snapshot();
CREATE FUNCTION app.protect_notice_delivery_recipient() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF (NEW.campaign_id, NEW.user_id, NEW.recipient_email) IS DISTINCT FROM (OLD.campaign_id, OLD.user_id, OLD.recipient_email) THEN
        RAISE EXCEPTION 'delivery recipient is immutable';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER notice_delivery_recipient_immutable BEFORE UPDATE ON app.notice_delivery
    FOR EACH ROW EXECUTE FUNCTION app.protect_notice_delivery_recipient();
CREATE TRIGGER notice_admin_audit_immutable BEFORE UPDATE OR DELETE ON app.notice_admin_audit
    FOR EACH ROW EXECUTE FUNCTION app.reject_free_usage_audit_mutation();
