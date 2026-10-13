package com.freelanceops.backend.domain.analysisdecision.repository;

import com.freelanceops.backend.domain.analysisdecision.entity.AnalysisDecisionEntity;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

public interface AnalysisDecisionRepository extends JpaRepository<AnalysisDecisionEntity, UUID> {
    Optional<AnalysisDecisionEntity> findByIdAndWorkspaceIdAndProjectId(UUID id, UUID workspaceId, UUID projectId);
    Optional<AnalysisDecisionEntity> findTopByWorkspaceIdAndProjectIdAndFamilyIdOrderByVersionNumberDesc(UUID workspaceId, UUID projectId, UUID familyId);
    Optional<AnalysisDecisionEntity> findByWorkspaceIdAndProjectIdAndCreatedByAndRequestId(UUID workspaceId, UUID projectId, UUID actor, UUID requestId);
    Optional<AnalysisDecisionEntity> findTopByWorkspaceIdAndProjectIdAndStatusOrderByConfirmedAtDescIdDesc(UUID workspaceId, UUID projectId, String status);
    List<AnalysisDecisionEntity> findByWorkspaceIdAndProjectIdOrderByCreatedAtDescIdDesc(UUID workspaceId, UUID projectId, Pageable pageable);
}
