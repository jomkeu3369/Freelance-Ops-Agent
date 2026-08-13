package com.freelanceops.backend.domain.agentrun.repository;

import com.freelanceops.backend.domain.agentrun.entity.AgentInterruptionEntity;
import com.freelanceops.backend.domain.agentrun.model.InterruptionStatus;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

public interface AgentInterruptionRepository extends JpaRepository<AgentInterruptionEntity, UUID> {
    Optional<AgentInterruptionEntity> findByIdAndWorkspaceIdAndAgentRunId(UUID id, UUID workspaceId, UUID agentRunId);
    Optional<AgentInterruptionEntity> findFirstByWorkspaceIdAndAgentRunIdAndStatus(UUID workspaceId, UUID agentRunId, InterruptionStatus status);
}
