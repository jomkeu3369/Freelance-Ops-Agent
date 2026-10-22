package com.freelanceops.backend.domain.agentrun.service;

import static org.assertj.core.api.Assertions.*;
import com.freelanceops.backend.domain.agentrun.dto.response.AgentRunView.ExternalToolCallUsage;
import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class ExternalToolSpendTest {
    private ExternalToolCallUsage call(String operation, boolean known) {
        return new ExternalToolCallUsage(UUID.randomUUID(), "TAVILY", operation,
                "tavily-basic-2026-10-22-v1", 1, new BigDecimal("0.008"), new BigDecimal("0.008"), known);
    }

    @Test void unknownOutcomeRetainsReservationAndDoesNotClaimSettledSpend() {
        assertThat(ExternalToolSpend.cost(List.of(call("SEARCH_BASIC", false)), true)).isNull();
        assertThat(ExternalToolSpend.cost(List.of(call("SEARCH_BASIC", false)), false)).isEqualByComparingTo("0.008");
        assertThat(ExternalToolSpend.cost(List.of(call("SEARCH_BASIC", true)), true)).isEqualByComparingTo("0.008");
    }

    @Test void advancedSearchCannotBorrowBasicSearchTariff() {
        assertThatThrownBy(() -> ExternalToolSpend.cost(List.of(call("SEARCH_ADVANCED", true)), false))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
