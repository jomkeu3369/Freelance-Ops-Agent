package com.freelanceops.backend.domain.quotation.dto.request;

import com.freelanceops.backend.domain.quotation.model.BasisType;
import com.freelanceops.backend.domain.quotation.model.EvidenceSourceType;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.Instant;

public record QuotationBasisRequest(
    @NotNull BasisType type,
    @NotBlank @Size(max = 3000) String content,
    EvidenceSourceType sourceType,
    @Size(max = 1000) String sourceReference,
    @Size(max = 300) String sourceTitle,
    Instant retrievedAt
) {
}
