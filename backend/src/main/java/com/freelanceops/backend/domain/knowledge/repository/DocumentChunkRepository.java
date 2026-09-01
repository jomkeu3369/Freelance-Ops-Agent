package com.freelanceops.backend.domain.knowledge.repository;

import com.freelanceops.backend.domain.knowledge.entity.DocumentChunkEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import java.util.List;
import java.util.UUID;

public interface DocumentChunkRepository extends JpaRepository<DocumentChunkEntity, UUID> {
    List<DocumentChunkEntity> findAllByWorkspaceIdAndDocumentIdOrderByChunkIndex(UUID workspaceId, UUID documentId);

    @Query("""
        select chunk from DocumentChunkEntity chunk, DocumentEntity document
        where chunk.workspaceId = :workspaceId
          and document.id = chunk.documentId
          and document.workspaceId = chunk.workspaceId
          and document.status = 'ACTIVE'
        order by document.id, chunk.chunkIndex
        """)
    List<DocumentChunkEntity> findAllActiveByWorkspaceId(@Param("workspaceId") UUID workspaceId);
}
