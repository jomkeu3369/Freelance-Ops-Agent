package com.freelanceops.backend.domain.agentrun.dto.response;

import com.freelanceops.backend.domain.agentrun.model.Provider;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

public record ModelPricingResponse(
    UUID id,
    Provider provider,
    String model,
    String versionLabel,
    String currency,
    BigDecimal inputPerMillion,
    BigDecimal cachedInputPerMillion,
    BigDecimal outputPerMillion,
    Instant validFrom,
    Instant validUntil
) { }
