package com.freelanceops.backend.domain.specification.repository;

import com.freelanceops.backend.domain.specification.entity.SpecificationEntity;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface SpecificationRepository extends JpaRepository<SpecificationEntity, UUID> {
    Optional<SpecificationEntity> findByIdAndWorkspaceIdAndProjectId(UUID id, UUID workspaceId, UUID projectId);
    Optional<SpecificationEntity> findTopByWorkspaceIdAndProjectIdOrderByRevisionNumberDesc(UUID workspaceId, UUID projectId);
    List<SpecificationEntity> findAllByWorkspaceIdAndProjectIdOrderByRevisionNumberDesc(UUID workspaceId, UUID projectId, Pageable page);
}
