package com.freelanceops.backend.domain.agentrun.repository;

import com.freelanceops.backend.domain.agentrun.entity.AgentRouteObservationEntity;
import com.freelanceops.backend.domain.agentrun.model.RouteReviewStatus;
import jakarta.persistence.LockModeType;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface AgentRouteObservationRepository extends JpaRepository<AgentRouteObservationEntity, UUID> {
    boolean existsByAgentRunIdAndAgentEventId(UUID agentRunId, long agentEventId);
    long countByReviewedAtIsNull();

    @Query("""
        select observation from AgentRouteObservationEntity observation
        where observation.workspaceId = :workspaceId
          and observation.reviewClaimedBy = :reviewerId
          and observation.reviewedAt is null
          and observation.reviewLeaseUntil > :now
          and observation.reviewStatus = :status
        order by observation.occurredAt, observation.id
        """)
    List<AgentRouteObservationEntity> findActiveClaims(@Param("workspaceId") UUID workspaceId,
                                                        @Param("reviewerId") UUID reviewerId,
                                                        @Param("now") Instant now,
                                                        @Param("status") RouteReviewStatus status,
                                                        Pageable pageable);

    @Query("select min(observation.occurredAt) from AgentRouteObservationEntity observation where observation.reviewedAt is null")
    Optional<Instant> oldestUnreviewedOccurredAt();

    @Query(value = """
        SELECT * FROM app.agent_route_observation observation
        WHERE observation.workspace_id = :workspaceId
          AND observation.reviewed_at IS NULL
          AND (observation.review_lease_until IS NULL OR observation.review_lease_until <= CURRENT_TIMESTAMP)
          AND observation.review_status = 'PENDING'
          AND (
            observation.route_data ->> 'route' IN ('REACT_AGENT', 'HUMAN_REQUIRED')
            OR (
              COALESCE(observation.route_data ->> 'shadowSuggestedRoute', '') <> ''
              AND observation.route_data ->> 'shadowSuggestedRoute' <> observation.route_data ->> 'route'
            )
          )
        ORDER BY observation.occurred_at, observation.id
        LIMIT :limit
        """, nativeQuery = true)
    List<AgentRouteObservationEntity> findRiskPending(@Param("workspaceId") UUID workspaceId,
                                                       @Param("limit") int limit);

    @Query(value = """
        SELECT * FROM app.agent_route_observation observation
        WHERE observation.workspace_id = :workspaceId
          AND observation.reviewed_at IS NULL
          AND (observation.review_lease_until IS NULL OR observation.review_lease_until <= CURRENT_TIMESTAMP)
          AND observation.review_status = 'PENDING'
          AND NOT (
            observation.route_data ->> 'route' IN ('REACT_AGENT', 'HUMAN_REQUIRED')
            OR (
              COALESCE(observation.route_data ->> 'shadowSuggestedRoute', '') <> ''
              AND observation.route_data ->> 'shadowSuggestedRoute' <> observation.route_data ->> 'route'
            )
          )
        ORDER BY observation.occurred_at, observation.id
        LIMIT :limit
        """, nativeQuery = true)
    List<AgentRouteObservationEntity> findNaturalPending(@Param("workspaceId") UUID workspaceId,
                                                          @Param("limit") int limit);

    @Query(value = """
        SELECT * FROM app.agent_route_observation observation
        WHERE observation.workspace_id = :workspaceId
          AND observation.reviewed_at IS NULL
          AND (observation.review_lease_until IS NULL OR observation.review_lease_until <= :now)
          AND NOT EXISTS (
            SELECT 1 FROM app.agent_route_review_vote vote
            WHERE vote.observation_id = observation.id AND vote.reviewer_id = :reviewerId
          )
          AND observation.review_status = 'PENDING'
          AND (
            observation.route_data ->> 'route' IN ('REACT_AGENT', 'HUMAN_REQUIRED')
            OR (
              COALESCE(observation.route_data ->> 'shadowSuggestedRoute', '') <> ''
              AND observation.route_data ->> 'shadowSuggestedRoute' <> observation.route_data ->> 'route'
            )
          )
        ORDER BY observation.occurred_at, observation.id
        FOR UPDATE SKIP LOCKED
        LIMIT :limit
        """, nativeQuery = true)
    List<AgentRouteObservationEntity> claimRiskPending(@Param("workspaceId") UUID workspaceId,
                                                        @Param("reviewerId") UUID reviewerId,
                                                        @Param("now") Instant now,
                                                        @Param("limit") int limit);

    @Query(value = """
        SELECT * FROM app.agent_route_observation observation
        WHERE observation.workspace_id = :workspaceId
          AND observation.reviewed_at IS NULL
          AND observation.review_status = 'ADJUDICATION'
          AND (observation.review_lease_until IS NULL OR observation.review_lease_until <= :now)
          AND NOT EXISTS (
            SELECT 1 FROM app.agent_route_review_vote vote
            WHERE vote.observation_id = observation.id AND vote.reviewer_id = :reviewerId
          )
        ORDER BY observation.occurred_at, observation.id
        FOR UPDATE SKIP LOCKED
        LIMIT :limit
        """, nativeQuery = true)
    List<AgentRouteObservationEntity> claimAdjudicationPending(@Param("workspaceId") UUID workspaceId,
                                                                @Param("reviewerId") UUID reviewerId,
                                                                @Param("now") Instant now,
                                                                @Param("limit") int limit);

    @Query(value = """
        SELECT * FROM app.agent_route_observation observation
        WHERE observation.workspace_id = :workspaceId
          AND observation.reviewed_at IS NULL
          AND (observation.review_lease_until IS NULL OR observation.review_lease_until <= :now)
          AND observation.review_status = 'PENDING'
          AND NOT EXISTS (
            SELECT 1 FROM app.agent_route_review_vote vote
            WHERE vote.observation_id = observation.id AND vote.reviewer_id = :reviewerId
          )
          AND NOT (
            observation.route_data ->> 'route' IN ('REACT_AGENT', 'HUMAN_REQUIRED')
            OR (
              COALESCE(observation.route_data ->> 'shadowSuggestedRoute', '') <> ''
              AND observation.route_data ->> 'shadowSuggestedRoute' <> observation.route_data ->> 'route'
            )
          )
        ORDER BY observation.occurred_at, observation.id
        FOR UPDATE SKIP LOCKED
        LIMIT :limit
        """, nativeQuery = true)
    List<AgentRouteObservationEntity> claimNaturalPending(@Param("workspaceId") UUID workspaceId,
                                                           @Param("reviewerId") UUID reviewerId,
                                                           @Param("now") Instant now,
                                                           @Param("limit") int limit);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select observation from AgentRouteObservationEntity observation where observation.id = :id and observation.workspaceId = :workspaceId")
    Optional<AgentRouteObservationEntity> findScopedForUpdate(@Param("id") UUID id, @Param("workspaceId") UUID workspaceId);

    @Query("select observation from AgentRouteObservationEntity observation where observation.id = :id and observation.workspaceId = :workspaceId")
    Optional<AgentRouteObservationEntity> findScoped(@Param("id") UUID id, @Param("workspaceId") UUID workspaceId);

    @Query("""
        select observation from AgentRouteObservationEntity observation
        where observation.workspaceId = :workspaceId
          and observation.occurredAt >= :since
          and observation.occurredAt < :until
          and observation.capturedAt <= :snapshotAt
        order by observation.occurredAt, observation.id
        """)
    List<AgentRouteObservationEntity> findExportPage(@Param("workspaceId") UUID workspaceId,
                                                      @Param("since") Instant since,
                                                      @Param("until") Instant until,
                                                      @Param("snapshotAt") Instant snapshotAt,
                                                      Pageable pageable);

    @Query("""
        select observation from AgentRouteObservationEntity observation
        where observation.workspaceId = :workspaceId
          and observation.occurredAt >= :since
          and observation.occurredAt < :until
          and observation.capturedAt <= :snapshotAt
          and (
            observation.occurredAt > :afterOccurredAt
            or observation.occurredAt = :afterOccurredAt and observation.id > :afterId
          )
        order by observation.occurredAt, observation.id
        """)
    List<AgentRouteObservationEntity> findExportPageAfter(@Param("workspaceId") UUID workspaceId,
                                                           @Param("since") Instant since,
                                                           @Param("until") Instant until,
                                                           @Param("snapshotAt") Instant snapshotAt,
                                                           @Param("afterOccurredAt") Instant afterOccurredAt,
                                                           @Param("afterId") UUID afterId,
                                                           Pageable pageable);
}
