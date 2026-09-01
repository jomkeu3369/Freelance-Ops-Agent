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

    public List<RaptorNodeEntity> nearest(UUID workspaceId, UUID snapshotId, float[] embedding, int limit) {
        return entityManager.createQuery("""
            select node from RaptorNodeEntity node
            where node.workspaceId = :workspaceId
              and node.snapshotId = :snapshotId
            order by cosine_distance(node.embedding, :embedding)
            """, RaptorNodeEntity.class)
            .setParameter("workspaceId", workspaceId).setParameter("snapshotId", snapshotId)
            .setParameter("embedding", embedding).setMaxResults(limit).getResultList();
    }
}
