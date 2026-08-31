package com.freelanceops.backend.domain.agenttask.repository;

import com.freelanceops.backend.domain.agenttask.entity.AgentTaskCommandEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

public interface AgentTaskCommandRepository extends JpaRepository<AgentTaskCommandEntity, UUID> {
    Optional<AgentTaskCommandEntity> findByWorkspaceIdAndTaskIdAndIdempotencyKey(UUID workspaceId, UUID taskId, String idempotencyKey);
}
