-- Legacy access is preserved. NULL verified_at is deliberately NOT backfilled as proof of ownership.
ALTER TABLE app.user_account
    ADD COLUMN email_verification_required BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN email_verified_at TIMESTAMPTZ,
    ADD COLUMN email_verification_token_hash CHAR(64),
    ADD COLUMN email_verification_expires_at TIMESTAMPTZ,
    ADD COLUMN email_verification_requested_at TIMESTAMPTZ,
    ADD COLUMN email_verification_day DATE,
    ADD COLUMN email_verification_daily_count INTEGER NOT NULL DEFAULT 0 CHECK (email_verification_daily_count >= 0);
CREATE UNIQUE INDEX uq_email_verification_hash ON app.user_account(email_verification_token_hash)
    WHERE email_verification_token_hash IS NOT NULL;
ALTER TABLE app.user_account ADD CONSTRAINT ck_email_verification_token_pair CHECK
    ((email_verification_token_hash IS NULL) = (email_verification_expires_at IS NULL));
