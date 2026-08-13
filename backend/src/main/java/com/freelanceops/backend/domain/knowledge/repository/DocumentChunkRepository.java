package com.freelanceops.backend.domain.knowledge.repository;

import com.freelanceops.backend.domain.knowledge.entity.DocumentChunkEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.UUID;

public interface DocumentChunkRepository extends JpaRepository<DocumentChunkEntity, UUID> {
    List<DocumentChunkEntity> findAllByWorkspaceIdAndDocumentIdOrderByChunkIndex(UUID workspaceId, UUID documentId);
}
