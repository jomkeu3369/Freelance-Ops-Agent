package com.freelanceops.backend.domain.agentrun.service;

import com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest.ModelSelection;
import com.freelanceops.backend.domain.agentrun.model.Provider;
import com.freelanceops.backend.domain.agentrun.model.ReasoningEffort;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.server.ResponseStatusException;

import java.util.UUID;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

class PlatformSpendServiceTest {
    @Test void spendingIsDisabledBeforeAnyDatabaseOrProviderWork() {
        var jdbc = mock(JdbcTemplate.class);
        var service = new PlatformSpendService(jdbc, false);
        assertThatThrownBy(() -> service.reserve(UUID.randomUUID(), UUID.randomUUID(),
            new ModelSelection(Provider.OPENAI, "gpt-5.6-luna", ReasoningEffort.LOW)))
            .isInstanceOfSatisfying(ResponseStatusException.class, error -> assertThat(error.getStatusCode().value()).isEqualTo(503));
        verifyNoInteractions(jdbc);
    }

    @Test void unpricedPlatformRouteFailsBeforeCreatingMonetaryReservation() {
        var jdbc = mock(JdbcTemplate.class);
        var service = new PlatformSpendService(jdbc, true);
        assertThatThrownBy(() -> service.reserve(UUID.randomUUID(), UUID.randomUUID(),
            new ModelSelection(Provider.OPENAI, "unpriced-model", ReasoningEffort.LOW)))
            .isInstanceOf(ResponseStatusException.class);
        verifyNoInteractions(jdbc);
    }
}
