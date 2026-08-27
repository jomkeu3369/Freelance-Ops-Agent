UPDATE app.agent_route_observation
SET review_target = 3
WHERE reviewed_at IS NULL
  AND (
    route_data ->> 'route' IN ('REACT_AGENT', 'HUMAN_REQUIRED')
    OR (
      COALESCE(route_data ->> 'shadowSuggestedRoute', '') <> ''
      AND route_data ->> 'shadowSuggestedRoute' <> route_data ->> 'route'
    )
  );

UPDATE app.agent_route_observation
SET review_target = 2
WHERE reviewed_at IS NULL
  AND review_votes = 0
  AND NOT (
    route_data ->> 'route' IN ('REACT_AGENT', 'HUMAN_REQUIRED')
    OR (
      COALESCE(route_data ->> 'shadowSuggestedRoute', '') <> ''
      AND route_data ->> 'shadowSuggestedRoute' <> route_data ->> 'route'
    )
  )
  AND MOD(hashtextextended(id::text, 0) & 9223372036854775807, 2) = 0;

UPDATE app.agent_route_observation
SET review_target = 3
WHERE reviewed_at IS NULL
  AND review_votes = 0
  AND review_target = 2
  AND NOT (
    route_data ->> 'route' IN ('REACT_AGENT', 'HUMAN_REQUIRED')
    OR (
      COALESCE(route_data ->> 'shadowSuggestedRoute', '') <> ''
      AND route_data ->> 'shadowSuggestedRoute' <> route_data ->> 'route'
    )
  )
  AND MOD(hashtextextended(id::text, 1) & 9223372036854775807, 100) < 5;

ALTER TABLE app.agent_route_observation
    DROP CONSTRAINT ck_agent_route_observation_risk_dual_review,
    ADD CONSTRAINT ck_agent_route_observation_risk_senior_review CHECK (
        reviewed_at IS NOT NULL
        OR NOT (
            route_data ->> 'route' IN ('REACT_AGENT', 'HUMAN_REQUIRED')
            OR (
                COALESCE(route_data ->> 'shadowSuggestedRoute', '') <> ''
                AND route_data ->> 'shadowSuggestedRoute' <> route_data ->> 'route'
            )
        )
        OR review_target = 3
    );
