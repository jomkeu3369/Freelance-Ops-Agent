package com.freelanceops.backend.domain.specification.dto.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

public record ConfirmSpecificationRequest(
    @NotBlank @Pattern(regexp = "[a-f0-9]{64}") String expectedContentHash,
    @NotBlank @Pattern(regexp = "CONFIRM_SPECIFICATION") String confirmation
) {}
