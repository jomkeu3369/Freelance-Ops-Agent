package com.freelanceops.backend.domain.specification.dto.request;

import jakarta.validation.constraints.NotNull;
import java.util.UUID;

public record CreateSpecificationRequest(@NotNull UUID decisionId, @NotNull UUID requestId) {}
