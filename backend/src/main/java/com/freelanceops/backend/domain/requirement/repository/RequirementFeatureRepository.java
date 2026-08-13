package com.freelanceops.backend.domain.requirement.repository;

import com.freelanceops.backend.domain.requirement.entity.RequirementFeatureEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.UUID;

public interface RequirementFeatureRepository extends JpaRepository<RequirementFeatureEntity, UUID> {
    List<RequirementFeatureEntity> findAllByWorkspaceIdAndRequirementVersionIdOrderBySortOrder(UUID workspaceId, UUID requirementVersionId);
}
