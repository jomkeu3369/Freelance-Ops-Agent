package com.freelanceops.backend.domain.agentrun.repository;

import com.freelanceops.backend.domain.agentrun.entity.AgentRunCommandEntity;
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

public interface AgentRunCommandRepository extends JpaRepository<AgentRunCommandEntity, UUID> {

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("""
        select command from AgentRunCommandEntity command,
             AgentRunEntity run,
             ProjectEntity project
        where command.runId = run.id
          and run.projectId = project.id
          and run.workspaceId = project.workspaceId
          and project.deletionRequestedAt is null
          and ((command.status = com.freelanceops.backend.domain.agentrun.model.AgentRunCommandStatus.PENDING
                and command.availableAt <= :now)
            or (command.status = com.freelanceops.backend.domain.agentrun.model.AgentRunCommandStatus.PROCESSING
                and command.leaseUntil <= :now))
        order by command.createdAt
        """)
    List<AgentRunCommandEntity> findDispatchableForUpdate(@Param("now") Instant now, Pageable pageable);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select command from AgentRunCommandEntity command where command.id = :id")
    Optional<AgentRunCommandEntity> findByIdForUpdate(@Param("id") UUID id);
}
