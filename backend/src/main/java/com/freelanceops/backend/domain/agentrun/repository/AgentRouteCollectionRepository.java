package com.freelanceops.backend.domain.agentrun.repository;

import com.freelanceops.backend.domain.agentrun.entity.AgentRouteCollectionEntity;
import com.freelanceops.backend.domain.agentrun.model.RouteCollectionStatus;
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

public interface AgentRouteCollectionRepository extends JpaRepository<AgentRouteCollectionEntity, UUID> {
    long countByStatusNot(RouteCollectionStatus status);

    @Query("select min(collection.availableAt) from AgentRouteCollectionEntity collection where collection.status <> com.freelanceops.backend.domain.agentrun.model.RouteCollectionStatus.COMPLETED")
    Optional<Instant> oldestIncompleteAvailableAt();

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("""
        select collection from AgentRouteCollectionEntity collection, AgentRunEntity run, ProjectEntity project
        where collection.agentRunId = run.id
          and run.projectId = project.id
          and run.workspaceId = project.workspaceId
          and project.deletionRequestedAt is null
          and ((collection.status = com.freelanceops.backend.domain.agentrun.model.RouteCollectionStatus.PENDING
                and collection.availableAt <= :now)
            or (collection.status = com.freelanceops.backend.domain.agentrun.model.RouteCollectionStatus.PROCESSING
                and collection.leaseUntil <= :now))
        order by collection.availableAt, collection.agentRunId
        """)
    List<AgentRouteCollectionEntity> findDispatchableForUpdate(@Param("now") Instant now, Pageable pageable);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select collection from AgentRouteCollectionEntity collection where collection.agentRunId = :runId")
    Optional<AgentRouteCollectionEntity> findByRunIdForUpdate(@Param("runId") UUID runId);
}
