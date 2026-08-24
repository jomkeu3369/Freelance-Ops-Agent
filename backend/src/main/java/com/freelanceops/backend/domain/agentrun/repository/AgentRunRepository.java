package com.freelanceops.backend.domain.agentrun.repository;

import com.freelanceops.backend.domain.agentrun.entity.AgentRunEntity;
import com.freelanceops.backend.domain.agentrun.model.AgentRunStatus;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import jakarta.persistence.LockModeType;

public interface AgentRunRepository extends JpaRepository<AgentRunEntity, UUID> {

    Optional<AgentRunEntity> findByIdAndWorkspaceId(UUID id, UUID workspaceId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select run from AgentRunEntity run where run.id = :id and run.workspaceId = :workspaceId")
    Optional<AgentRunEntity> findByIdAndWorkspaceIdForUpdate(@Param("id") UUID id, @Param("workspaceId") UUID workspaceId);

    Optional<AgentRunEntity> findFirstByWorkspaceIdAndProjectIdOrderByUpdatedAtDesc(UUID workspaceId, UUID projectId);

    List<AgentRunEntity> findAllByWorkspaceIdAndProjectIdAndStatusIn(UUID workspaceId, UUID projectId, Collection<AgentRunStatus> statuses);

    boolean existsByIdAndWorkspaceId(UUID id, UUID workspaceId);

    boolean existsByWorkspaceIdAndProjectIdAndStatusIn(UUID workspaceId, UUID projectId, Collection<AgentRunStatus> statuses);

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Transactional
    @Query("""
        UPDATE AgentRunEntity run
        SET run.status = :status,
            run.updatedAt = :updatedAt,
            run.version = run.version + 1
        WHERE run.id = :runId
          AND run.workspaceId = :workspaceId
          AND run.status NOT IN :terminalStatuses
          AND run.status <> :status
        """)
    int synchronizeStatus(
        @Param("runId") UUID runId,
        @Param("workspaceId") UUID workspaceId,
        @Param("status") AgentRunStatus status,
        @Param("updatedAt") Instant updatedAt,
        @Param("terminalStatuses") Collection<AgentRunStatus> terminalStatuses
    );
}


