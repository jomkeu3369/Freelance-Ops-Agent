package com.freelanceops.backend.domain.agentrun.repository;

import com.freelanceops.backend.domain.agentrun.entity.AgentRunEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

public interface AgentRunRepository extends JpaRepository<AgentRunEntity, UUID> {

    Optional<AgentRunEntity> findByIdAndWorkspaceId(UUID id, UUID workspaceId);

    boolean existsByIdAndWorkspaceId(UUID id, UUID workspaceId);
}


