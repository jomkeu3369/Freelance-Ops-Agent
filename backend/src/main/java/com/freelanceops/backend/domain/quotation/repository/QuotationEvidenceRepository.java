package com.freelanceops.backend.domain.quotation.repository;

import com.freelanceops.backend.domain.quotation.entity.QuotationEvidenceEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.UUID;

public interface QuotationEvidenceRepository extends JpaRepository<QuotationEvidenceEntity, UUID> {
    List<QuotationEvidenceEntity> findAllByWorkspaceIdAndQuotationId(UUID workspaceId, UUID quotationId);
}
