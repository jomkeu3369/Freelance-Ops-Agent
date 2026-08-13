package com.freelanceops.backend.domain.requirement.dto.request;

import com.freelanceops.backend.domain.requirement.model.RequirementPriority;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

public record RequirementFeatureRequest(
    @NotBlank @Size(max = 200) String title,
    @NotBlank @Size(max = 5000) String description,
    @NotNull RequirementPriority priority,
    @Size(max = 5000) String acceptanceCriteria
) {
}
