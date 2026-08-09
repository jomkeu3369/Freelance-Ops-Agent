package com.freelanceops.backend.workspace.infrastructure.persistence;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

public interface WorkspaceMemberRepository extends JpaRepository<WorkspaceMemberEntity, UUID> {

    Optional<WorkspaceMemberEntity> findByUserIdAndWorkspaceIdAndStatus(
        UUID userId,
        UUID workspaceId,
        String status
    );
}
