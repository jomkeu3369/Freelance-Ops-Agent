package com.freelanceops.backend.domain.requirement.dto.request;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;

public record CreateRequirementVersionRequest(
    @NotBlank @Size(max = 50000) String sourceText,
    @NotNull @Size(max = 100) List<@Valid RequirementFeatureRequest> features,
    @NotNull @Size(max = 100) List<@NotBlank @Size(max = 3000) String> assumptions,
    @NotNull @Size(max = 100) List<@NotBlank @Size(max = 3000) String> questions
) {
}
