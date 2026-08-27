package com.freelanceops.backend.domain.agentrun.repository;

import com.freelanceops.backend.domain.agentrun.entity.AgentRouteReviewVoteEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public interface AgentRouteReviewVoteRepository extends JpaRepository<AgentRouteReviewVoteEntity, UUID> {
    boolean existsByObservationIdAndReviewerId(UUID observationId, UUID reviewerId);
    List<AgentRouteReviewVoteEntity> findByObservationIdOrderByReviewedAtAscIdAsc(UUID observationId);

    @Query(value = """
        WITH ranked_votes AS (
            SELECT vote.observation_id, vote.gold_route,
                   ROW_NUMBER() OVER (
                       PARTITION BY vote.observation_id ORDER BY vote.reviewed_at, vote.id
                   ) AS vote_number
            FROM app.agent_route_review_vote vote
            WHERE vote.workspace_id = :workspaceId
        ), reviewed AS (
            SELECT observation.id,
                   observation.review_target,
                   observation.review_status,
                   (
                       observation.route_data ->> 'route' IN ('REACT_AGENT', 'HUMAN_REQUIRED')
                       OR (
                           COALESCE(observation.route_data ->> 'shadowSuggestedRoute', '') <> ''
                           AND observation.route_data ->> 'shadowSuggestedRoute'
                               <> observation.route_data ->> 'route'
                       )
                   ) AS risk,
                   MAX(vote.gold_route) FILTER (WHERE vote.vote_number = 1) AS first_vote,
                   MAX(vote.gold_route) FILTER (WHERE vote.vote_number = 2) AS second_vote,
                   MAX(vote.gold_route) FILTER (WHERE vote.vote_number = 3) AS third_vote
            FROM app.agent_route_observation observation
            LEFT JOIN ranked_votes vote ON vote.observation_id = observation.id
            WHERE observation.workspace_id = :workspaceId
              AND observation.occurred_at >= :since
            GROUP BY observation.id
        )
        SELECT
            COUNT(*) FILTER (WHERE review_status = 'COMPLETED') AS "completedGold",
            COUNT(*) FILTER (WHERE review_status = 'ADJUDICATION') AS "pendingAdjudications",
            COUNT(*) FILTER (
                WHERE review_status = 'COMPLETED' AND review_target = 3 AND third_vote IS NOT NULL
            ) AS "seniorAudits",
            COUNT(*) FILTER (
                WHERE review_status = 'COMPLETED' AND review_target >= 2
                  AND first_vote IS NOT NULL AND second_vote IS NOT NULL
            ) AS "dualCompleted",
            COUNT(*) FILTER (
                WHERE review_status = 'COMPLETED' AND review_target >= 2
                  AND first_vote IS NOT NULL AND second_vote IS NOT NULL
                  AND first_vote IS DISTINCT FROM second_vote
            ) AS "disagreements",
            COUNT(*) FILTER (
                WHERE risk AND review_status = 'COMPLETED' AND review_target = 3
                  AND first_vote = second_vote AND third_vote IS NOT NULL
            ) AS "riskConsensusAudits",
            COUNT(*) FILTER (
                WHERE risk AND review_status = 'COMPLETED' AND review_target = 3
                  AND first_vote = second_vote AND third_vote IS DISTINCT FROM first_vote
            ) AS "riskConsensusOverturns",
            COUNT(*) FILTER (
                WHERE NOT risk AND review_status = 'COMPLETED' AND review_target = 3
                  AND first_vote = second_vote AND third_vote IS NOT NULL
            ) AS "naturalConsensusAudits",
            COUNT(*) FILTER (
                WHERE NOT risk AND review_status = 'COMPLETED' AND review_target = 3
                  AND first_vote = second_vote AND third_vote IS DISTINCT FROM first_vote
            ) AS "naturalConsensusOverturns"
        FROM reviewed
        """, nativeQuery = true)
    RouteReviewCanaryStatsProjection canaryStats(@Param("workspaceId") UUID workspaceId,
                                                   @Param("since") Instant since);

    @Query(value = """
        WITH ranked_votes AS (
            SELECT vote.observation_id, vote.gold_route, vote.reviewed_at,
                   ROW_NUMBER() OVER (
                       PARTITION BY vote.observation_id ORDER BY vote.reviewed_at, vote.id
                   ) AS vote_number
            FROM app.agent_route_review_vote vote
            WHERE vote.workspace_id = :workspaceId
        ), reviewed AS (
            SELECT observation.id,
                   (
                       observation.route_data ->> 'route' IN ('REACT_AGENT', 'HUMAN_REQUIRED')
                       OR (
                           COALESCE(observation.route_data ->> 'shadowSuggestedRoute', '') <> ''
                           AND observation.route_data ->> 'shadowSuggestedRoute'
                               <> observation.route_data ->> 'route'
                       )
                   ) AS risk,
                   MAX(vote.gold_route) FILTER (WHERE vote.vote_number = 1) AS first_vote,
                   MAX(vote.gold_route) FILTER (WHERE vote.vote_number = 2) AS second_vote,
                   MAX(vote.gold_route) FILTER (WHERE vote.vote_number = 3) AS third_vote,
                   MAX(vote.reviewed_at) FILTER (WHERE vote.vote_number = 3) AS audited_at
            FROM app.agent_route_observation observation
            LEFT JOIN ranked_votes vote ON vote.observation_id = observation.id
            WHERE observation.workspace_id = :workspaceId
              AND observation.occurred_at >= :since
              AND observation.review_status = 'COMPLETED'
              AND observation.review_target = 3
            GROUP BY observation.id
        ), consensus_audits AS (
            SELECT reviewed.*,
                   ROW_NUMBER() OVER (
                       PARTITION BY risk ORDER BY audited_at, id
                   ) AS audit_number
            FROM reviewed
            WHERE first_vote = second_vote AND third_vote IS NOT NULL
        )
        SELECT
            COUNT(*) FILTER (WHERE risk) AS "riskAvailable",
            COUNT(*) FILTER (WHERE risk AND audit_number <= :checkpoint) AS "riskSampled",
            COUNT(*) FILTER (
                WHERE risk AND audit_number <= :checkpoint AND third_vote IS DISTINCT FROM first_vote
            ) AS "riskOverturns",
            COUNT(*) FILTER (WHERE NOT risk) AS "naturalAvailable",
            COUNT(*) FILTER (WHERE NOT risk AND audit_number <= :checkpoint) AS "naturalSampled",
            COUNT(*) FILTER (
                WHERE NOT risk AND audit_number <= :checkpoint AND third_vote IS DISTINCT FROM first_vote
            ) AS "naturalOverturns"
        FROM consensus_audits
        """, nativeQuery = true)
    RouteReviewCheckpointStatsProjection checkpointStats(@Param("workspaceId") UUID workspaceId,
                                                           @Param("since") Instant since,
                                                           @Param("checkpoint") int checkpoint);
}
