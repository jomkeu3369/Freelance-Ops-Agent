package com.freelanceops.backend.domain.requirement.repository;

import com.freelanceops.backend.domain.requirement.entity.RequirementQuestionEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.UUID;

public interface RequirementQuestionRepository extends JpaRepository<RequirementQuestionEntity, UUID> {
    List<RequirementQuestionEntity> findAllByWorkspaceIdAndRequirementVersionIdOrderBySortOrder(UUID workspaceId, UUID requirementVersionId);
}
