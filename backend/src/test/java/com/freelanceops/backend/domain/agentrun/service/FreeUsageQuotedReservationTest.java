package com.freelanceops.backend.domain.agentrun.service;

import com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest.CreditQuote;
import com.freelanceops.backend.domain.agentrun.model.Provider;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import tools.jackson.databind.ObjectMapper;

import java.sql.Date;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class FreeUsageQuotedReservationTest {
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final FreeUsageService service = new FreeUsageService(jdbc, mock(ObjectMapper.class));
    private final UUID user = UUID.randomUUID();
    private final Instant version = Instant.parse("2026-10-01T00:00:00.123456Z");

    @BeforeEach void setup() {
        when(jdbc.queryForObject(contains("weekly_credit_settings"), org.mockito.ArgumentMatchers.<RowMapper<FreeUsageService.Settings>>any()))
            .thenReturn(new FreeUsageService.Settings(100, 100000, 4, version, null));
        when(jdbc.query(contains("weekly_credit_model_rate"), org.mockito.ArgumentMatchers.<RowMapper<FreeUsageService.ModelRate>>any()))
            .thenReturn(List.of(new FreeUsageService.ModelRate(Provider.OPENAI, "gpt-5.6-luna", 10, true),
                new FreeUsageService.ModelRate(Provider.OPENAI, "gpt-5.6-terra", 100, true)));
        when(jdbc.queryForObject(anyString(), eq(Boolean.class), any())).thenReturn(true);
        when(jdbc.queryForObject("SELECT clock_timestamp()", Timestamp.class))
            .thenReturn(Timestamp.from(Instant.parse("2026-10-04T14:59:59Z")));
        when(jdbc.update(contains("SET reserved = reserved + ?"), any(Object[].class))).thenReturn(1);
    }

    @Test void reservesExactWeightedCreditsAndPinsRateVersionAndAdmissionWeek() {
        UUID run = UUID.randomUUID();
        service.reserveQuoted(user, run, Provider.OPENAI, "gpt-5.6-terra", new CreditQuote(100, version));
        verify(jdbc).update(contains("SET reserved = reserved + ?"), eq(100), eq(user),
            eq(Date.valueOf(LocalDate.parse("2026-09-28"))), eq(4L), eq(100), eq(100));
        verify(jdbc).update(contains("INSERT INTO app.weekly_credit_reservation"), eq(run), eq(user),
            eq(Date.valueOf(LocalDate.parse("2026-09-28"))), eq(4L), eq(100), eq("OPENAI"),
            eq("gpt-5.6-terra"), eq(Timestamp.from(version)));
    }

    @Test void absentStaleAndWrongPricesRejectBeforeAnyWrite() {
        for (CreditQuote quote : java.util.Arrays.asList(null, new CreditQuote(10, version.minusNanos(1000)), new CreditQuote(1, version))) {
            assertThatThrownBy(() -> service.reserveQuoted(user, UUID.randomUUID(), Provider.OPENAI, "gpt-5.6-luna", quote))
                .isInstanceOf(CreditQuoteException.class);
        }
        verify(jdbc, never()).update(anyString(), any(Object[].class));
    }

    @Test void unavailableAndUnregisteredModelsHaveNoFallbackPrice() {
        when(jdbc.query(contains("weekly_credit_model_rate"), org.mockito.ArgumentMatchers.<RowMapper<FreeUsageService.ModelRate>>any()))
            .thenReturn(List.of(new FreeUsageService.ModelRate(Provider.OPENAI, "gpt-5.6-luna", 10, false)));
        for (String model : List.of("gpt-5.6-luna", "gpt-5.6-terra", "gpt-unknown")) {
            assertThatThrownBy(() -> service.reserveQuoted(user, UUID.randomUUID(), Provider.OPENAI, model, new CreditQuote(10, version)))
                .isInstanceOfSatisfying(CreditQuoteException.class, e -> assertThat(e.code()).isEqualTo("PLATFORM_MODEL_UNAVAILABLE"));
        }
        verify(jdbc, never()).update(anyString(), any(Object[].class));
    }
}
