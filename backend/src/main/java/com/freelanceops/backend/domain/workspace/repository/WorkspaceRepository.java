package com.freelanceops.backend.domain.workspace.repository;

import com.freelanceops.backend.domain.workspace.entity.WorkspaceEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;

public interface WorkspaceRepository extends JpaRepository<WorkspaceEntity, UUID> {
}


