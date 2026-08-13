package com.freelanceops.backend.domain.outcome.repository;

import com.freelanceops.backend.domain.outcome.entity.ActualOutcomeEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.Optional;
import java.util.UUID;

public interface ActualOutcomeRepository extends JpaRepository<ActualOutcomeEntity, UUID> {
    Optional<ActualOutcomeEntity> findByWorkspaceIdAndProjectId(UUID workspaceId, UUID projectId);
}
