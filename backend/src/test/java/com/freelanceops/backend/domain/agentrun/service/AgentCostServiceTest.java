package com.freelanceops.backend.domain.agentrun.service;

import com.freelanceops.backend.domain.agentrun.dto.response.AgentRunView.AgentRunUsage;
import com.freelanceops.backend.domain.agentrun.dto.request.CreateModelPricingRequest;
import com.freelanceops.backend.domain.agentrun.entity.ModelPricingEntity;
import com.freelanceops.backend.domain.agentrun.model.Provider;
import com.freelanceops.backend.domain.agentrun.model.RequestTier;
import com.freelanceops.backend.domain.agentrun.repository.AgentRunRepository;
import com.freelanceops.backend.domain.agentrun.repository.AgentRunUsageRepository;
import com.freelanceops.backend.domain.agentrun.repository.ModelPricingRepository;
import com.freelanceops.backend.domain.workspace.policy.AuthorizationDecision;
import com.freelanceops.backend.domain.workspace.policy.PermissionCode;
import com.freelanceops.backend.domain.workspace.service.WorkspaceAuthorizationService;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

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

    @Test
    void rejectsOverlappingModelPricingPeriodBeforeInsert() {
        ModelPricingRepository pricingRepository = mock(ModelPricingRepository.class);
        WorkspaceAuthorizationService authorization = mock(WorkspaceAuthorizationService.class);
        AgentCostService service = new AgentCostService(
            pricingRepository, mock(AgentRunUsageRepository.class), mock(AgentRunRepository.class), authorization
        );
        UUID userId = UUID.randomUUID();
        UUID workspaceId = UUID.randomUUID();
        Instant validFrom = Instant.parse("2026-08-01T00:00:00Z");
        Instant validUntil = Instant.parse("2026-09-01T00:00:00Z");
        CreateModelPricingRequest request = new CreateModelPricingRequest(
            Provider.OPENAI, "gpt-test", "2026-08", "USD",
            BigDecimal.ONE, BigDecimal.ZERO, BigDecimal.TEN, validFrom, validUntil
        );
        when(authorization.authorize(userId, workspaceId, PermissionCode.WORKSPACE_UPDATE))
            .thenReturn(AuthorizationDecision.ALLOWED);
        when(pricingRepository.hasOverlappingPeriod(
            workspaceId, Provider.OPENAI, "gpt-test", validFrom, validUntil
        )).thenReturn(true);

        assertThatThrownBy(() -> service.createPricing(userId, workspaceId, request))
            .isInstanceOf(ResponseStatusException.class)
            .extracting(error -> ((ResponseStatusException) error).getStatusCode().value())
            .isEqualTo(409);
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
