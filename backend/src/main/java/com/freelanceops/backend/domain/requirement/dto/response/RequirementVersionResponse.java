package com.freelanceops.backend.domain.requirement.dto.response;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record RequirementVersionResponse(
    UUID id,
    UUID workspaceId,
    UUID projectId,
    int versionNumber,
    String sourceText,
    List<RequirementFeatureResponse> features,
    List<String> assumptions,
    List<RequirementQuestionResponse> questions,
    UUID createdBy,
    Instant createdAt
) {
}
