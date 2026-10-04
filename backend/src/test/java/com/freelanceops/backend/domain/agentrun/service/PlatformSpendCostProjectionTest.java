package com.freelanceops.backend.domain.agentrun.service;

import com.freelanceops.backend.domain.agentrun.dto.response.AgentRunView;
import com.freelanceops.backend.domain.agentrun.dto.response.AgentRunView.AgentRunUsage;
import com.freelanceops.backend.domain.agentrun.dto.response.AgentRunView.ProviderCallUsage;
import com.freelanceops.backend.domain.agentrun.entity.AgentRunEntity;
import com.freelanceops.backend.domain.agentrun.entity.AgentRunUsageEntity;
import com.freelanceops.backend.domain.agentrun.model.*;
import com.freelanceops.backend.domain.agentrun.repository.*;
import com.freelanceops.backend.domain.workspace.service.WorkspaceAuthorizationService;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

class PlatformSpendCostProjectionTest {
    @Test void failedMixedModelRunUsesServerTariffAndRetainsCostRegardlessOfCreditRefund() {
        var prices = mock(ModelPricingRepository.class);
        var usages = mock(AgentRunUsageRepository.class);
        var service = new AgentCostService(prices, usages, mock(AgentRunRepository.class), mock(WorkspaceAuthorizationService.class));
        UUID runId = UUID.randomUUID();
        var run = new AgentRunEntity(runId, UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
            Provider.OPENAI, "gpt-5.6-terra", AgentRunStatus.FAILED, Instant.now());
        var calls = List.of(call("gpt-5.6-luna"), call("gpt-5.6-terra"));
        // Both reported platform cost and mutable workspace pricing are ignored.
        var usage = new AgentRunUsage(RequestTier.SINGLE_AGENT, 2, 0, 2000, 1000, 0, 0, 0, 0, 100,
            calls, BigDecimal.ZERO, runId, PlatformSpendService.TARIFF_VERSION);
        service.synchronize(run, new AgentRunView(runId, AgentRunStatus.FAILED, null, null, null, "FAILED",
            new AgentRunView.AgentRunMetadata(Provider.OPENAI, "gpt-5.6-terra", "v1", "v1", "trace"), usage, Instant.now()));
        var stored = ArgumentCaptor.forClass(AgentRunUsageEntity.class);
        verify(usages).save(stored.capture());
        assertThat(stored.getValue().actualCost()).isEqualByComparingTo("0.0088");
        assertThat(stored.getValue().platformCostUsd()).isEqualByComparingTo("0.0088");
        assertThat(stored.getValue().billableOutcome()).isFalse();
        assertThat(stored.getValue().costStatus()).isEqualTo(CostStatus.PRICED);
        verifyNoInteractions(prices);
    }

    private static ProviderCallUsage call(String model) {
        return new ProviderCallUsage(UUID.randomUUID(), Provider.OPENAI, model, "responses.create", 1000, 500,
            0, 0, BigDecimal.ZERO, new BigDecimal(".1"), true, "PLATFORM");
    }
}
