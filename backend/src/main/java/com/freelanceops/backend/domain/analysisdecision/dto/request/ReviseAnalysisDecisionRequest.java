package com.freelanceops.backend.domain.analysisdecision.dto.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.UUID;

public record ReviseAnalysisDecisionRequest(
    @NotNull UUID requestId,
    @NotBlank @Pattern(regexp = "[a-f0-9]{64}") String expectedContentHash,
    @NotBlank @Size(max = 100000) String bodyText
) { }
