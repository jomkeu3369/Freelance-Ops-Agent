package com.freelanceops.backend.domain.requirement.repository;

import com.freelanceops.backend.domain.requirement.entity.RequirementVersionEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface RequirementVersionRepository extends JpaRepository<RequirementVersionEntity, UUID> {
    List<RequirementVersionEntity> findAllByWorkspaceIdAndProjectIdOrderByVersionNumberDesc(UUID workspaceId, UUID projectId);
    Optional<RequirementVersionEntity> findByIdAndWorkspaceIdAndProjectId(UUID id, UUID workspaceId, UUID projectId);
    Optional<RequirementVersionEntity> findTopByWorkspaceIdAndProjectIdOrderByVersionNumberDesc(UUID workspaceId, UUID projectId);
}
