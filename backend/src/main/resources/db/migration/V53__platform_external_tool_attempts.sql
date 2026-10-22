-- 모델 시도와 분리하여 이전 서버도 기존 모델 원장을 계속 읽을 수 있게 한다.
CREATE TABLE app.platform_external_tool_attempt (
    call_id UUID PRIMARY KEY,
    run_id UUID NOT NULL REFERENCES app.platform_spend_reservation(run_id),
    payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX ix_platform_external_tool_run ON app.platform_external_tool_attempt(run_id);
CREATE TRIGGER platform_external_tool_attempt_no_delete BEFORE DELETE ON app.platform_external_tool_attempt
    FOR EACH ROW EXECUTE FUNCTION app.reject_platform_spend_reservation_mutation();
