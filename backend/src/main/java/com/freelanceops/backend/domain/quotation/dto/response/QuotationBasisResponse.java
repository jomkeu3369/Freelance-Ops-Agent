package com.freelanceops.backend.domain.quotation.dto.response;

import com.freelanceops.backend.domain.quotation.model.BasisType;
import com.freelanceops.backend.domain.quotation.model.EvidenceSourceType;
import java.time.Instant;

public record QuotationBasisResponse(BasisType type, String content, EvidenceSourceType sourceType, String sourceReference, String sourceTitle, Instant retrievedAt) {
}
