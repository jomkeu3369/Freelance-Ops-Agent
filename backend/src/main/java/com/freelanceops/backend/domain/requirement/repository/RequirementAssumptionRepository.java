package com.freelanceops.backend.domain.requirement.repository;

import com.freelanceops.backend.domain.requirement.entity.RequirementAssumptionEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.UUID;

public interface RequirementAssumptionRepository extends JpaRepository<RequirementAssumptionEntity, UUID> {
    List<RequirementAssumptionEntity> findAllByWorkspaceIdAndRequirementVersionIdOrderBySortOrder(UUID workspaceId, UUID requirementVersionId);
}
