package com.freelanceops.backend.domain.internaltool.dto.response;

import java.util.List;
import java.time.LocalDate;

public record DomainPack(
    String code,
    String version,
    String jurisdictionCode,
    String professionCode,
    String scope,
    List<String> requiredFields,
    List<String> questionTemplates,
    List<SourceReference> sourceReferences,
    LocalDate effectiveFrom,
    LocalDate effectiveUntil
) {
    public record SourceReference(String title, String url) {
    }
}
