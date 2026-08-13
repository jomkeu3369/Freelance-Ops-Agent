package com.freelanceops.backend.domain.knowledge.repository;

import com.freelanceops.backend.domain.knowledge.entity.DocumentChunkEntity;
import jakarta.persistence.EntityManager;
import org.springframework.stereotype.Repository;
import java.util.List;
import java.util.UUID;

@Repository
public class KnowledgeSearchRepository {
    private final EntityManager entityManager;

    public KnowledgeSearchRepository(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    public List<DocumentChunkEntity> keywordSearch(UUID workspaceId, String query, int limit) {
        return entityManager.createQuery("""
            select chunk from DocumentChunkEntity chunk, DocumentEntity document
            where chunk.workspaceId = :workspaceId
              and document.id = chunk.documentId
              and document.workspaceId = chunk.workspaceId
              and document.status = 'ACTIVE'
              and sql('to_tsvector(''simple'', ?) @@ plainto_tsquery(''simple'', ?)', chunk.content, :query) = true
            order by sql('ts_rank_cd(to_tsvector(''simple'', ?), plainto_tsquery(''simple'', ?))', chunk.content, :query) desc
            """, DocumentChunkEntity.class)
            .setParameter("workspaceId", workspaceId)
            .setParameter("query", query)
            .setMaxResults(limit)
            .getResultList();
    }

    public List<DocumentChunkEntity> vectorSearch(UUID workspaceId, float[] embedding, int limit) {
        return entityManager.createQuery("""
            select chunk from DocumentChunkEntity chunk, DocumentEntity document
            where chunk.workspaceId = :workspaceId
              and document.id = chunk.documentId
              and document.workspaceId = chunk.workspaceId
              and document.status = 'ACTIVE'
              and chunk.embedding is not null
            order by cosine_distance(chunk.embedding, :embedding)
            """, DocumentChunkEntity.class)
            .setParameter("workspaceId", workspaceId)
            .setParameter("embedding", embedding)
            .setMaxResults(limit)
            .getResultList();
    }
}
