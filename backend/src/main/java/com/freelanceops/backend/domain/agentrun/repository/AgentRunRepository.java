package com.freelanceops.backend.domain.agentrun.repository;

import com.freelanceops.backend.domain.agentrun.entity.AgentRunEntity;
import com.freelanceops.backend.domain.agentrun.model.AgentRunStatus;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.Optional;
import java.util.UUID;

public interface AgentRunRepository extends JpaRepository<AgentRunEntity, UUID> {

    Optional<AgentRunEntity> findByIdAndWorkspaceId(UUID id, UUID workspaceId);

    Optional<AgentRunEntity> findFirstByWorkspaceIdAndProjectIdOrderByUpdatedAtDesc(UUID workspaceId, UUID projectId);

    boolean existsByIdAndWorkspaceId(UUID id, UUID workspaceId);

    boolean existsByWorkspaceIdAndProjectIdAndStatusIn(UUID workspaceId, UUID projectId, Collection<AgentRunStatus> statuses);
}


