ALTER TABLE app.agent_route_observation
    ADD COLUMN review_claimed_by UUID REFERENCES app.user_account(id),
    ADD COLUMN review_lease_until TIMESTAMPTZ;

ALTER TABLE app.agent_route_observation
    ADD CONSTRAINT ck_agent_route_observation_claim_complete CHECK (
        (
            reviewed_at IS NULL
            AND (
                (review_claimed_by IS NULL AND review_lease_until IS NULL)
                OR
                (review_claimed_by IS NOT NULL AND review_lease_until IS NOT NULL)
            )
        )
        OR
        (
            reviewed_at IS NOT NULL
            AND review_claimed_by IS NULL
            AND review_lease_until IS NULL
        )
    );

CREATE INDEX ix_agent_route_observation_claimable
    ON app.agent_route_observation(workspace_id, review_lease_until, occurred_at, id)
    WHERE reviewed_at IS NULL;
