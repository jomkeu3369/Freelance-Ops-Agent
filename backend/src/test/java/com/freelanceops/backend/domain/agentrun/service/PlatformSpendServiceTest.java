package com.freelanceops.backend.domain.agentrun.service;

import com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest.ModelSelection;
import com.freelanceops.backend.domain.agentrun.model.Provider;
import com.freelanceops.backend.domain.agentrun.model.ReasoningEffort;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.server.ResponseStatusException;

import java.util.UUID;
import java.util.List;
import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.Instant;
import org.springframework.jdbc.core.RowMapper;

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
    @Test void zeroModelCapFailsClosedBeforeCreatingBucketsOrReservation() {
        var jdbc = mock(JdbcTemplate.class);
        var service = new PlatformSpendService(jdbc, true);
        when(jdbc.queryForObject(contains("FROM app.platform_spend_settings"),
            org.mockito.ArgumentMatchers.<RowMapper<PlatformSpendService.Settings>>any()))
            .thenReturn(new PlatformSpendService.Settings(BigDecimal.ONE, BigDecimal.ONE, BigDecimal.ONE,
                BigDecimal.ONE, BigDecimal.ONE));
        when(jdbc.queryForObject("SELECT clock_timestamp()", Timestamp.class))
            .thenReturn(Timestamp.from(Instant.parse("2026-10-06T00:00:00Z")));
        when(jdbc.query(contains("FROM app.platform_spend_model_cap"),
            org.mockito.ArgumentMatchers.<RowMapper<BigDecimal>>any(), eq("OPENAI"), eq("gpt-5.6-luna")))
            .thenReturn(List.of(BigDecimal.ZERO));
        assertThatThrownBy(() -> service.reserve(UUID.randomUUID(), UUID.randomUUID(),
            new ModelSelection(Provider.OPENAI, "gpt-5.6-luna", ReasoningEffort.LOW)))
            .isInstanceOf(PlatformSpendUnavailableException.class);
        verify(jdbc, never()).update(anyString(), any(Object[].class));
        verify(jdbc, never()).query(contains("FROM app.platform_spend_bucket"), any(RowMapper.class),
            anyString(), any(UUID.class), any(java.sql.Date.class));
    }

}
