package com.freelanceops.backend.domain.quotation.repository;

import com.freelanceops.backend.domain.quotation.entity.QuotationItemEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface QuotationItemRepository extends JpaRepository<QuotationItemEntity, UUID> {
    List<QuotationItemEntity> findAllByWorkspaceIdAndQuotationIdOrderBySortOrder(UUID workspaceId, UUID quotationId);
    Optional<QuotationItemEntity> findByIdAndWorkspaceId(UUID id, UUID workspaceId);
}
