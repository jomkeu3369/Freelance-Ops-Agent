package com.freelanceops.backend.domain.memory.repository;

import com.freelanceops.backend.domain.memory.entity.SourceMessageEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface SourceMessageRepository extends JpaRepository<SourceMessageEntity, UUID> {
    List<SourceMessageEntity> findAllByWorkspaceIdAndProjectIdOrderByEventOrderAsc(UUID workspaceId, UUID projectId);
    Optional<SourceMessageEntity> findByEventKey(String eventKey);
    List<SourceMessageEntity> findAllByWorkspaceIdAndProjectIdAndIdInOrderByEventOrderAsc(UUID workspaceId, UUID projectId, List<UUID> ids);
}
