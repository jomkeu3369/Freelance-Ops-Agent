package com.freelanceops.backend.domain.knowledge.repository;
import com.freelanceops.backend.domain.knowledge.entity.DocumentChunkEntity;
import jakarta.persistence.EntityManager;
import org.springframework.stereotype.Repository;
import java.util.List;
import java.util.UUID;

@Repository
public class KnowledgeSearchRepository {
    private final EntityManager entityManager;
    public KnowledgeSearchRepository(EntityManager entityManager) { this.entityManager = entityManager; }

    public List<DocumentChunkEntity> keywordSearch(UUID workspaceId, UUID projectId, UUID excludedRunId, String query, int limit) {
        return entityManager.createQuery("""
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
              and cast(sql('to_tsvector(''simple'', ?) @@ plainto_tsquery(''simple'', ?)', chunk.content, :query) as Boolean) = true
            order by sql('ts_rank_cd(to_tsvector(''simple'', ?), plainto_tsquery(''simple'', ?))', chunk.content, :query) desc
            """, DocumentChunkEntity.class)
            .setParameter("workspaceId", workspaceId).setParameter("projectId", projectId).setParameter("excludedRunId", excludedRunId)
            .setParameter("query", query).setMaxResults(limit).getResultList();
    }

    public List<DocumentChunkEntity> vectorSearch(UUID workspaceId, UUID projectId, UUID excludedRunId, float[] embedding, String embeddingModel, int limit) {
        return entityManager.createQuery("""
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
              and chunk.embedding is not null and chunk.embeddingModel = :embeddingModel
            order by cosine_distance(chunk.embedding, :embedding)
            """, DocumentChunkEntity.class)
            .setParameter("workspaceId", workspaceId).setParameter("projectId", projectId).setParameter("excludedRunId", excludedRunId)
            .setParameter("embedding", embedding).setParameter("embeddingModel", embeddingModel).setMaxResults(limit).getResultList();
    }
}
