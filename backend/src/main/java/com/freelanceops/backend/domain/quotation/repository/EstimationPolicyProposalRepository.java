package com.freelanceops.backend.domain.quotation.repository;

import com.freelanceops.backend.domain.quotation.entity.EstimationPolicyProposalEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.Optional;
import java.util.List;
import java.util.UUID;

public interface EstimationPolicyProposalRepository extends JpaRepository<EstimationPolicyProposalEntity, UUID> {
    Optional<EstimationPolicyProposalEntity> findByIdAndWorkspaceId(UUID id, UUID workspaceId);
    Optional<EstimationPolicyProposalEntity> findByWorkspaceIdAndCreatedByAndIdempotencyKey(UUID workspaceId, UUID createdBy, UUID idempotencyKey);
    List<EstimationPolicyProposalEntity> findTop20ByWorkspaceIdAndProjectIdAndCreatedByOrderByCreatedAtDesc(UUID workspaceId, UUID projectId, UUID createdBy);
}
