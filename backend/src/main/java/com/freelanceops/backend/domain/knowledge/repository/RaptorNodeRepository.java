package com.freelanceops.backend.domain.knowledge.repository;

import com.freelanceops.backend.domain.knowledge.entity.RaptorNodeEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.UUID;

public interface RaptorNodeRepository extends JpaRepository<RaptorNodeEntity, UUID> {
    List<RaptorNodeEntity> findAllByWorkspaceIdAndSnapshotId(UUID workspaceId, UUID snapshotId);
}
