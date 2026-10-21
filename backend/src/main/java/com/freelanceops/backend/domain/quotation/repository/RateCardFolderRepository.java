package com.freelanceops.backend.domain.quotation.repository;

import com.freelanceops.backend.domain.quotation.entity.RateCardFolderEntity;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface RateCardFolderRepository extends JpaRepository<RateCardFolderEntity, UUID> {
    List<RateCardFolderEntity> findAllByWorkspaceIdOrderByName(UUID workspaceId);

    Optional<RateCardFolderEntity> findByIdAndWorkspaceId(UUID id, UUID workspaceId);

    boolean existsByWorkspaceIdAndParentId(UUID workspaceId, UUID parentId);
}
