-- Model catalogue and monetary caps only. No new per-model product credit charges.
-- Copy existing operator caps; do not increase account/global limits or enable spending.
CREATE TABLE app.platform_spend_model_cap (
    provider VARCHAR(20) NOT NULL CHECK (provider = 'OPENAI'),
    model VARCHAR(100) NOT NULL CHECK (model IN ('gpt-6-luna', 'gpt-6-sol', 'gpt-6.1-sol', 'gpt-6-astra',
        'gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol')),
    max_run_usd NUMERIC(19,8) NOT NULL CHECK (max_run_usd > 0 AND max_run_usd <= 100),
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    PRIMARY KEY (provider, model)
);
INSERT INTO app.platform_spend_model_cap(provider, model, max_run_usd)
SELECT 'OPENAI', model, CASE WHEN model IN ('gpt-6-luna', 'gpt-5.6-luna') THEN luna_run_usd ELSE terra_run_usd END
FROM app.platform_spend_settings CROSS JOIN (VALUES
    ('gpt-6-luna'), ('gpt-6-sol'), ('gpt-6.1-sol'), ('gpt-6-astra'),
    ('gpt-5.6-luna'), ('gpt-5.6-terra'), ('gpt-5.6-sol')) AS models(model)
WHERE id = 1;
