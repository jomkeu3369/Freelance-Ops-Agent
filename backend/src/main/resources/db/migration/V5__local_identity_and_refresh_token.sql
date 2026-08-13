ALTER TABLE app.user_account
    ADD COLUMN display_name VARCHAR(100),
    ADD COLUMN password_hash VARCHAR(100),
    ADD COLUMN version BIGINT NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX uq_user_account_email_normalized
    ON app.user_account (LOWER(email));

CREATE TABLE app.refresh_token (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES app.user_account(id) ON DELETE CASCADE,
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT ck_refresh_token_expiry CHECK (expires_at > created_at)
);

CREATE INDEX ix_refresh_token_user_active
    ON app.refresh_token(user_id, expires_at)
    WHERE revoked_at IS NULL;
