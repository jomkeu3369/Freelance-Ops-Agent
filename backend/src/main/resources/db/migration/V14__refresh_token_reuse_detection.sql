ALTER TABLE app.refresh_token
    ADD COLUMN family_id UUID,
    ADD COLUMN parent_token_id UUID,
    ADD COLUMN replaced_by_token_id UUID,
    ADD COLUMN revoke_reason VARCHAR(30),
    ADD COLUMN reuse_detected_at TIMESTAMPTZ;

UPDATE app.refresh_token
SET family_id = id
WHERE family_id IS NULL;

ALTER TABLE app.refresh_token
    ALTER COLUMN family_id SET NOT NULL,
    ADD CONSTRAINT fk_refresh_token_parent
        FOREIGN KEY (parent_token_id) REFERENCES app.refresh_token(id),
    ADD CONSTRAINT fk_refresh_token_replacement
        FOREIGN KEY (replaced_by_token_id) REFERENCES app.refresh_token(id),
    ADD CONSTRAINT ck_refresh_token_not_self_parent
        CHECK (parent_token_id IS NULL OR parent_token_id <> id),
    ADD CONSTRAINT ck_refresh_token_not_self_replacement
        CHECK (replaced_by_token_id IS NULL OR replaced_by_token_id <> id),
    ADD CONSTRAINT ck_refresh_token_revoke_reason
        CHECK (revoke_reason IS NULL OR revoke_reason IN ('ROTATED', 'LOGOUT', 'REUSE_DETECTED', 'ADMIN_REVOKED'));

CREATE INDEX ix_refresh_token_family
    ON app.refresh_token(family_id, created_at);

CREATE INDEX ix_refresh_token_reuse_detected
    ON app.refresh_token(user_id, reuse_detected_at DESC)
    WHERE reuse_detected_at IS NOT NULL;
