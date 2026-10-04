package com.freelanceops.backend.domain.agentrun.service;

import com.freelanceops.backend.domain.agentrun.dto.response.AgentRunView.ProviderCallUsage;
import com.freelanceops.backend.domain.agentrun.model.Provider;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.*;

class PlatformSpendTariffTest {
    @Test void mixedModelRoutingAndRetriesUsePerAttemptTariffs() {
        var luna = call("gpt-5.6-luna", 1000, 500, 200, 100, true);
        var terra = call("gpt-5.6-terra", 1000, 500, 200, 100, true);
        // Luna 700*.20+200*.02+100*.25+500*1.20 = 769 / million.
        assertThat(PlatformSpendTariff.calculate(luna)).isEqualByComparingTo("0.00076900");
        assertThat(PlatformSpendTariff.actualCost(List.of(luna, terra), 2, PlatformSpendService.TARIFF_VERSION))
            .isEqualByComparingTo("0.00845900");
    }

    @Test void unknownAttemptIsNotReportedAsZeroOrAnActualPrice() {
        var unknown = call("gpt-5.6-luna", 1000, 500, 0, 0, false);
        assertThat(PlatformSpendTariff.actualCost(List.of(unknown), 1, PlatformSpendService.TARIFF_VERSION)).isNull();
        assertThat(PlatformSpendTariff.conservativeCost(List.of(unknown), 1, PlatformSpendService.TARIFF_VERSION))
            .isEqualByComparingTo("0.01");
    }

    @Test void missingAttemptsOrUnknownTariffCannotBePriced() {
        var luna = call("gpt-5.6-luna", 1000, 500, 0, 0, true);
        assertThat(PlatformSpendTariff.actualCost(List.of(luna), 2, PlatformSpendService.TARIFF_VERSION)).isNull();
        assertThat(PlatformSpendTariff.actualCost(List.of(luna), 1, "user-pricing-v1")).isNull();
        assertThatThrownBy(() -> PlatformSpendTariff.requirePriceable(Provider.OPENAI, "unpriced-model"))
            .isInstanceOf(ResponseStatusException.class);
    }

    @Test void personalCredentialSpendDoesNotConsumePlatformBudget() {
        var route = call("gpt-5.6-luna", 1000, 500, 0, 0, true);
        var byok = new ProviderCallUsage(UUID.randomUUID(), Provider.OPENAI, "gpt-5.6-terra", "responses.create",
            5000, 1000, 0, 0, new BigDecimal("0.022"), BigDecimal.ZERO, false, "BYOK");
        assertThat(PlatformSpendTariff.actualCost(List.of(route, byok), 2, PlatformSpendService.TARIFF_VERSION))
            .isEqualByComparingTo("0.0008");
        assertThat(PlatformSpendTariff.conservativeCost(List.of(route, byok), 2, PlatformSpendService.TARIFF_VERSION))
            .isEqualByComparingTo("0.0008");
    }

    @Test void periodsUseMondayKoreaBoundaryAndExpireBeforeNewBudgetDay() {
        var sunday = PlatformSpendService.Period.at(Instant.parse("2026-10-04T14:59:59Z"));
        assertThat(sunday.week().toString()).isEqualTo("2026-09-28");
        assertThat(sunday.validUntil()).isEqualTo(Instant.parse("2026-10-04T15:00:00Z"));
        var monday = PlatformSpendService.Period.at(Instant.parse("2026-10-04T15:00:00Z"));
        assertThat(monday.week().toString()).isEqualTo("2026-10-05");
        assertThat(monday.day()).isEqualTo(monday.week());
    }

    private static ProviderCallUsage call(String model, long input, long output, long cached, long written, boolean known) {
        return new ProviderCallUsage(UUID.randomUUID(), Provider.OPENAI, model, "responses.create", input, output,
            cached, written, BigDecimal.ZERO, new BigDecimal("0.01"), known);
    }
}
