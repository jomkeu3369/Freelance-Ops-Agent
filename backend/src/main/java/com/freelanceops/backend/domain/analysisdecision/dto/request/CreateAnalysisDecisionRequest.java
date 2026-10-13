package com.freelanceops.backend.domain.analysisdecision.dto.request;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.UUID;

/** The client selects identities; the server owns every source opinion. */
public record CreateAnalysisDecisionRequest(
    @NotNull UUID requestId,
    @NotNull UUID sourceRunId,
    @Min(0) long expectedProjectVersion,
    @NotNull @Size(min = 1, max = 3) List<@NotBlank @Size(max = 80) String> selectedOpinionIds
) { }
