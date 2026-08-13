package com.freelanceops.backend.domain.outcome.repository;

import com.freelanceops.backend.domain.outcome.entity.ActualWorkItemEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.UUID;

public interface ActualWorkItemRepository extends JpaRepository<ActualWorkItemEntity, UUID> {
    List<ActualWorkItemEntity> findAllByWorkspaceIdAndOutcomeIdOrderBySortOrder(UUID workspaceId, UUID outcomeId);
    void deleteAllByWorkspaceIdAndOutcomeId(UUID workspaceId, UUID outcomeId);
}
