-- Read-only account administration is independent of workspace roles and quota writes.
-- Do not grant this capability to any existing account automatically.
ALTER TABLE app.platform_admin_grant DROP CONSTRAINT platform_admin_grant_capability_check;
ALTER TABLE app.platform_admin_grant ADD CHECK (capability IN ('FREE_USAGE_ADMIN', 'NOTICES_ADMIN', 'MEMBERS_READ'));

CREATE TABLE app.login_activity_metadata (
    id SMALLINT PRIMARY KEY CHECK (id = 1),
    recording_started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO app.login_activity_metadata(id) VALUES (1);

-- Only successful interactive authentication. No IP, user agent, email, token, or payload.
-- Never infer/backfill historical logins from refresh tokens or account timestamps.
CREATE TABLE app.user_login_event (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES app.user_account(id) ON DELETE CASCADE,
    method VARCHAR(24) NOT NULL CHECK (method IN ('PASSWORD', 'REGISTRATION')),
    occurred_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX ix_user_login_event_user_time ON app.user_login_event(user_id, occurred_at DESC, id DESC);
CREATE INDEX ix_user_login_event_time ON app.user_login_event(occurred_at DESC, id DESC);
CREATE INDEX ix_user_account_created_id ON app.user_account(created_at DESC, id DESC);
