package com.freelanceops.backend.domain.agenttask.repository;

import com.freelanceops.backend.domain.agenttask.entity.AgentTaskEntity;
import com.freelanceops.backend.domain.agenttask.model.AgentTaskStatus;
import org.springframework.data.domain.Pageable;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;
import java.util.List;
import java.util.UUID;

public interface AgentTaskRepository extends JpaRepository<AgentTaskEntity, UUID> {

    @Query(value = "select 1 from pg_advisory_xact_lock(hashtextextended(cast(:taskId as text), 0))", nativeQuery = true)
    int lockRegistration(@Param("taskId") UUID taskId);

    Optional<AgentTaskEntity> findByIdAndWorkspaceId(UUID id, UUID workspaceId);

    @Query("select task from AgentTaskEntity task where task.specialistProfile = 'research-read-v1' and task.workspaceId in :workspaces and task.status in :statuses and (:afterId is null or task.id > :afterId) order by task.id")
    List<AgentTaskEntity> findRecoveryCandidates(@Param("workspaces") List<UUID> workspaces, @Param("statuses") List<AgentTaskStatus> statuses, @Param("afterId") UUID afterId, Pageable page);

    List<AgentTaskEntity> findAllByWorkspaceIdAndRunIdOrderByCreatedAtAsc(UUID workspaceId, UUID runId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select task from AgentTaskEntity task where task.id = :id and task.workspaceId = :workspaceId")
    Optional<AgentTaskEntity> findByIdAndWorkspaceIdForUpdate(@Param("id") UUID id, @Param("workspaceId") UUID workspaceId);
}
