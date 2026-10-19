-- 생성 요청과 결과를 보존해 저장 재전송이나 응답 유실이 모델 재호출로 이어지지 않게 한다.
ALTER TABLE app.pet_generation
    ADD COLUMN project_id UUID,
    ADD COLUMN pet_id UUID,
    ADD COLUMN expected_revision BIGINT,
    ADD COLUMN request_hash VARCHAR(64),
    ADD COLUMN request_json TEXT CHECK (length(request_json) <= 4000),
    ADD COLUMN previous_json TEXT CHECK (length(previous_json) <= 12000),
    ADD COLUMN profile_json TEXT CHECK (length(profile_json) <= 12000),
    ADD COLUMN error_code VARCHAR(80),
    ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp();

ALTER TABLE app.pet_profile DROP CONSTRAINT pet_profile_profile_json_check;
ALTER TABLE app.pet_profile ADD CONSTRAINT pet_profile_profile_json_check CHECK (length(profile_json) <= 12000);
