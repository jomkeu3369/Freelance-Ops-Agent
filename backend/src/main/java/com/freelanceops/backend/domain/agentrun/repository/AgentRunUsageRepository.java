package com.freelanceops.backend.domain.agentrun.repository;

import com.freelanceops.backend.domain.agentrun.entity.AgentRunUsageEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

public interface AgentRunUsageRepository extends JpaRepository<AgentRunUsageEntity, UUID> {
    Optional<AgentRunUsageEntity> findByAgentRunIdAndWorkspaceId(UUID agentRunId, UUID workspaceId);
}
