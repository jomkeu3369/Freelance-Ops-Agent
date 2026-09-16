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
        where chunk.workspaceId = :workspaceId and document.id = chunk.documentId and document.workspaceId = chunk.workspaceId
              and document.status = 'ACTIVE'
              and document.retrievalEligible = true
              and document.confirmationStatus = 'confirmed'
              and document.memoryType not in ('assumption', 'response')
              and (document.effectiveFrom is null or document.effectiveFrom <= current_date)
              and (document.effectiveUntil is null or document.effectiveUntil >= current_date)
              and (document.projectId is null or document.projectId = :projectId)
              and (document.sourceRunId is null or :excludedRunId is null or document.sourceRunId <> :excludedRunId)
          and chunk.id in :ids
        """)
    List<DocumentChunkEntity> findEligibleByIds(@Param("workspaceId") UUID workspaceId, @Param("projectId") UUID projectId, @Param("excludedRunId") UUID excludedRunId, @Param("ids") List<UUID> ids);

    @Query("""
        select chunk from DocumentChunkEntity chunk, DocumentEntity document
        where chunk.workspaceId = :workspaceId
          and document.id = chunk.documentId
          and document.workspaceId = chunk.workspaceId
          and document.status = 'ACTIVE'
              and document.retrievalEligible = true
              and document.confirmationStatus = 'confirmed'
              and document.memoryType not in ('assumption', 'response')
              and (document.effectiveFrom is null or document.effectiveFrom <= current_date)
              and (document.effectiveUntil is null or document.effectiveUntil >= current_date)
        order by document.id, chunk.chunkIndex
        """)
    List<DocumentChunkEntity> findAllActiveByWorkspaceId(@Param("workspaceId") UUID workspaceId);
}
