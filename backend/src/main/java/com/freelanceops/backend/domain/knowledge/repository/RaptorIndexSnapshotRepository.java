package com.freelanceops.backend.domain.knowledge.repository;

import com.freelanceops.backend.domain.knowledge.entity.RaptorIndexSnapshotEntity;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.*;
import org.springframework.data.repository.query.Param;
import java.util.Optional;
import java.util.UUID;

public interface RaptorIndexSnapshotRepository extends JpaRepository<RaptorIndexSnapshotEntity, UUID> {
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select snapshot from RaptorIndexSnapshotEntity snapshot where snapshot.id = :id and snapshot.workspaceId = :workspaceId")
    Optional<RaptorIndexSnapshotEntity> findForUpdate(@Param("workspaceId") UUID workspaceId, @Param("id") UUID id);
}
