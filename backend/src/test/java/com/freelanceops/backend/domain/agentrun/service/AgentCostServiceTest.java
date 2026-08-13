package com.freelanceops.backend.domain.agentrun.service;

import com.freelanceops.backend.domain.agentrun.dto.response.AgentRunView.AgentRunUsage;
import com.freelanceops.backend.domain.agentrun.entity.ModelPricingEntity;
import com.freelanceops.backend.domain.agentrun.model.Provider;
import com.freelanceops.backend.domain.agentrun.model.RequestTier;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class AgentCostServiceTest {

    @Test
    void calculatesVersionedModelCostWithoutFloatingPoint() {
        AgentRunUsage usage = new AgentRunUsage(
            RequestTier.MULTI_DEPARTMENT, 5, 2, 1000, 500, 200, 0, 0, 1, 2500
        );
        ModelPricingEntity pricing = pricing();

        BigDecimal cost = AgentCostService.calculate(usage, pricing);

        assertThat(cost).isEqualByComparingTo("0.01170000");
    }

    @Test
    void rejectsCachedTokensGreaterThanInputTokens() {
        assertThatThrownBy(() -> new AgentRunUsage(
            RequestTier.SINGLE_AGENT, 1, 0, 10, 5, 11, 0, 0, 0, 100
        )).isInstanceOf(IllegalArgumentException.class);
    }

    private static ModelPricingEntity pricing() {
        Instant now = Instant.parse("2026-08-13T00:00:00Z");
        return new ModelPricingEntity(
            UUID.randomUUID(), UUID.randomUUID(), Provider.OPENAI, "gpt-test", "2026-08",
            "USD", new BigDecimal("5.00"), new BigDecimal("1.00"), new BigDecimal("15.00"),
            now, null, UUID.randomUUID(), now
        );
    }
}
