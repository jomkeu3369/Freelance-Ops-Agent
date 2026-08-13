package com.freelanceops.backend.domain.agentrun.repository;

import com.freelanceops.backend.domain.agentrun.entity.ToolExecutionEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface ToolExecutionRepository extends JpaRepository<ToolExecutionEntity, UUID> {
    List<ToolExecutionEntity> findByWorkspaceIdAndAgentRunIdOrderByStartedAt(UUID workspaceId, UUID agentRunId);
}
