CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE app.model_pricing
    ADD CONSTRAINT ex_model_pricing_no_overlapping_period
    EXCLUDE USING gist (
        workspace_id WITH =,
        provider WITH =,
        model WITH =,
        tstzrange(valid_from, COALESCE(valid_until, 'infinity'::timestamptz), '[)') WITH &&
    );

CREATE INDEX ix_agent_route_observation_export
    ON app.agent_route_observation(workspace_id, occurred_at, id)
    INCLUDE (captured_at);
