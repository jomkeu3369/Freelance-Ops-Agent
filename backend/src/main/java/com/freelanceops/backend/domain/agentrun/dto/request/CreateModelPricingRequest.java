package com.freelanceops.backend.domain.agentrun.dto.request;

import com.freelanceops.backend.domain.agentrun.model.Provider;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.math.BigDecimal;
import java.time.Instant;

public record CreateModelPricingRequest(
    @NotNull Provider provider,
    @NotBlank @Size(max = 100) String model,
    @NotBlank @Size(max = 100) String versionLabel,
    @NotBlank @Pattern(regexp = "^[A-Z]{3}$") String currency,
    @NotNull @DecimalMin("0") BigDecimal inputPerMillion,
    @NotNull @DecimalMin("0") BigDecimal cachedInputPerMillion,
    @NotNull @DecimalMin("0") BigDecimal outputPerMillion,
    @NotNull Instant validFrom,
    Instant validUntil
) { }
