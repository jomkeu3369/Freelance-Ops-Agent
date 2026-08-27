INSERT INTO app.permission (code, description)
VALUES ('agent.route.adjudicate', 'Adjudicate conflicting Agent routing reviews')
ON CONFLICT (code) DO NOTHING;

INSERT INTO app.role_permission (workspace_id, role_id, permission_code)
SELECT workspace_id, id, 'agent.route.adjudicate'
FROM app.workspace_role
WHERE code IN ('OWNER', 'ADMIN')
ON CONFLICT (role_id, permission_code) DO NOTHING;

ALTER TABLE app.agent_route_observation
    ADD COLUMN review_target INTEGER NOT NULL DEFAULT 1 CHECK (review_target BETWEEN 1 AND 3),
    ADD COLUMN review_votes INTEGER NOT NULL DEFAULT 0 CHECK (review_votes BETWEEN 0 AND 3),
    ADD COLUMN review_status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (review_status IN ('PENDING', 'ADJUDICATION', 'COMPLETED'));

UPDATE app.agent_route_observation
SET review_status = 'COMPLETED', review_votes = 1
WHERE reviewed_at IS NOT NULL;

UPDATE app.agent_route_observation
SET review_target = 2
WHERE reviewed_at IS NULL
  AND (
    route_data ->> 'route' IN ('REACT_AGENT', 'HUMAN_REQUIRED')
    OR (
      COALESCE(route_data ->> 'shadowSuggestedRoute', '') <> ''
      AND route_data ->> 'shadowSuggestedRoute' <> route_data ->> 'route'
    )
    OR MOD(hashtextextended(id::text, 0) & 9223372036854775807, 4) = 0
  );

ALTER TABLE app.agent_route_observation
    ADD CONSTRAINT ck_agent_route_observation_consensus CHECK (
        (review_status = 'COMPLETED' AND reviewed_at IS NOT NULL AND review_votes >= 1)
        OR
        (review_status = 'PENDING' AND reviewed_at IS NULL AND review_votes < review_target)
        OR
        (review_status = 'ADJUDICATION' AND reviewed_at IS NULL AND review_target = 3 AND review_votes = 2)
    ),
    ADD CONSTRAINT ck_agent_route_observation_risk_dual_review CHECK (
        reviewed_at IS NOT NULL
        OR NOT (
            route_data ->> 'route' IN ('REACT_AGENT', 'HUMAN_REQUIRED')
            OR (
                COALESCE(route_data ->> 'shadowSuggestedRoute', '') <> ''
                AND route_data ->> 'shadowSuggestedRoute' <> route_data ->> 'route'
            )
        )
        OR review_target >= 2
    );

CREATE TABLE app.agent_route_review_vote (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL,
    observation_id UUID NOT NULL,
    reviewer_id UUID NOT NULL REFERENCES app.user_account(id),
    gold_route VARCHAR(30) NOT NULL CHECK (
        gold_route IN ('DIRECT_TOOL', 'SIMPLE_LLM', 'REACT_AGENT', 'SUPERVISOR', 'HUMAN_REQUIRED')
    ),
    correction_source VARCHAR(30) NOT NULL CHECK (
        correction_source IN ('HUMAN_REVIEW', 'USER_EDIT')
    ),
    reviewed_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT uq_agent_route_review_vote_reviewer UNIQUE (observation_id, reviewer_id),
    CONSTRAINT fk_agent_route_review_vote_scope FOREIGN KEY (workspace_id, observation_id)
        REFERENCES app.agent_route_observation(workspace_id, id) ON DELETE CASCADE
);

CREATE INDEX ix_agent_route_review_vote_observation
    ON app.agent_route_review_vote(observation_id, reviewed_at, id);
