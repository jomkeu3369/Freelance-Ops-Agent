package com.freelanceops.backend.domain.knowledge.repository;
import com.freelanceops.backend.domain.knowledge.entity.RaptorNodeEntity;
import jakarta.persistence.EntityManager;
import org.springframework.stereotype.Repository;
import java.util.List;
import java.util.UUID;

@Repository
public class RaptorNodeSearchRepository {
    private final EntityManager entityManager;

    public RaptorNodeSearchRepository(EntityManager entityManager) { this.entityManager = entityManager; }

    public List<RaptorNodeEntity> nearest(UUID workspaceId, UUID snapshotId, float[] embedding, String embeddingModel, int limit) {
        return entityManager.createQuery("""
            select node from RaptorNodeEntity node, RaptorIndexSnapshotEntity snapshot
            where node.workspaceId = :workspaceId
              and node.snapshotId = :snapshotId
              and snapshot.id = node.snapshotId and snapshot.embeddingModel = :embeddingModel
            order by cosine_distance(node.embedding, :embedding)
            """, RaptorNodeEntity.class)
            .setParameter("workspaceId", workspaceId).setParameter("snapshotId", snapshotId)
            .setParameter("embedding", embedding).setParameter("embeddingModel", embeddingModel).setMaxResults(limit).getResultList();
    }
}
