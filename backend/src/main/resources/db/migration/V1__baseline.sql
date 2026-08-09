CREATE TABLE IF NOT EXISTS app.service_metadata (
    service_name VARCHAR(100) PRIMARY KEY,
    schema_version VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO app.service_metadata (service_name, schema_version)
VALUES ('freelance-ops-backend', '0.1.0')
ON CONFLICT (service_name) DO NOTHING;

