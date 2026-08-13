package com.freelanceops.backend.domain.quotation.repository;

import com.freelanceops.backend.domain.quotation.entity.RateCardEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface RateCardRepository extends JpaRepository<RateCardEntity, UUID> {
    List<RateCardEntity> findAllByWorkspaceIdOrderByName(UUID workspaceId);
    Optional<RateCardEntity> findByIdAndWorkspaceId(UUID id, UUID workspaceId);
}
