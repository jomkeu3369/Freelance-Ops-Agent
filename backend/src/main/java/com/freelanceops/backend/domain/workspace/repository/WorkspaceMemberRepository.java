package com.freelanceops.backend.domain.workspace.repository;

import com.freelanceops.backend.domain.workspace.entity.WorkspaceMemberEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.List;
import java.util.UUID;

public interface WorkspaceMemberRepository extends JpaRepository<WorkspaceMemberEntity, UUID> {

    Optional<WorkspaceMemberEntity> findByUserIdAndWorkspaceIdAndStatus(
        UUID userId,
        UUID workspaceId,
        String status
    );

    List<WorkspaceMemberEntity> findAllByUserIdAndStatusOrderByJoinedAtAsc(UUID userId, String status);
}


