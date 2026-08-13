package com.freelanceops.backend.domain.knowledge.repository;

import com.freelanceops.backend.domain.knowledge.entity.DocumentEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface DocumentRepository extends JpaRepository<DocumentEntity, UUID> {
    List<DocumentEntity> findAllByWorkspaceIdAndStatusOrderByCreatedAtDesc(UUID workspaceId, String status);
    Optional<DocumentEntity> findByIdAndWorkspaceId(UUID id, UUID workspaceId);
}
