package com.freelanceops.backend.domain.internaltool.dto.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.util.List;
import java.util.UUID;

public record RequirementDraft(
    @NotNull UUID projectId,
    @NotBlank @Size(max = 10000) String summary,
    @NotNull @Size(max = 200) List<@NotBlank @Size(max = 1000) String> features,
    @NotNull @Size(max = 200) List<@NotBlank @Size(max = 1000) String> constraints,
    @NotNull @Size(max = 200) List<@NotBlank @Size(max = 1000) String> assumptions,
    @NotNull @Size(max = 100) List<@NotBlank @Size(max = 1000) String> openQuestions
) {
}
