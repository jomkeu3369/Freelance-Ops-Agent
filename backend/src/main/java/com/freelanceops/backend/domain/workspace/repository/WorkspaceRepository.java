package com.freelanceops.backend.domain.workspace.repository;

import com.freelanceops.backend.domain.workspace.entity.WorkspaceEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import jakarta.persistence.LockModeType;

import java.util.Optional;
import java.util.UUID;

public interface WorkspaceRepository extends JpaRepository<WorkspaceEntity, UUID> {
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select workspace from WorkspaceEntity workspace where workspace.id = :id")
    Optional<WorkspaceEntity> findByIdForUpdate(@Param("id") UUID id);
}


