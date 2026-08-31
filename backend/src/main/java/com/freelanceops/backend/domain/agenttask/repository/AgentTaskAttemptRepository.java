package com.freelanceops.backend.domain.agenttask.repository;

import com.freelanceops.backend.domain.agenttask.entity.AgentTaskAttemptEntity;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;
import java.util.UUID;

public interface AgentTaskAttemptRepository extends JpaRepository<AgentTaskAttemptEntity, UUID> {

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select attempt from AgentTaskAttemptEntity attempt where attempt.id = :id and attempt.workspaceId = :workspaceId")
    Optional<AgentTaskAttemptEntity> findByIdAndWorkspaceIdForUpdate(@Param("id") UUID id, @Param("workspaceId") UUID workspaceId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select attempt from AgentTaskAttemptEntity attempt where attempt.taskId = :taskId and attempt.taskRevision = :revision and attempt.attemptNumber = :attemptNumber")
    Optional<AgentTaskAttemptEntity> findCurrentForUpdate(@Param("taskId") UUID taskId, @Param("revision") int revision, @Param("attemptNumber") int attemptNumber);
}
