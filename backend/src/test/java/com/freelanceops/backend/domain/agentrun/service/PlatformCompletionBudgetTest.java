package com.freelanceops.backend.domain.agentrun.service;

import com.freelanceops.backend.domain.agentrun.client.dto.request.InternalAgentRunRequest.PlatformBudget;
import com.freelanceops.backend.domain.agentrun.client.dto.request.InternalAgentRunRequest.PlatformCompletionEnvelope;
import com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest.RunBudget;
import com.freelanceops.backend.domain.agentrun.dto.response.AgentRunView.ProviderCallUsage;
import com.freelanceops.backend.domain.agentrun.model.Provider;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import tools.jackson.databind.json.JsonMapper;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.*;

/** Synthetic ceilings only: these tests do not prescribe operator spending policy. */
class PlatformCompletionBudgetTest {
    private static final JsonMapper MAPPER = JsonMapper.builder().findAndAddModules().build();

    @Test void fullReservationIncludesMostExpensiveRouterCacheWriteAndEveryAttemptRounding() {
        var budget = budget(7, 2345, 1234);
        // Astra bounds all input categories at 12.50/million and output at 50/million.
        assertThat(PlatformSpendTariff.fullReservation(List.of("gpt-6-luna", "gpt-6-astra"), budget,
            PlatformSpendTariff.VERSION)).isEqualByComparingTo(".09101256");
        assertThat(PlatformSpendTariff.fullReservation(List.of("gpt-6-astra", "gpt-6-luna", "gpt-6-astra"), budget,
            PlatformSpendTariff.VERSION)).isEqualByComparingTo(".09101256");
    }

    @Test void aggregateBoundCoversSeparatelyRoundedCacheWriteCalls() {
        var budget = budget(50, 50, 50);
        var cap = PlatformSpendTariff.fullReservation(List.of("gpt-6-luna"), budget, PlatformSpendTariff.VERSION);
        var calls = new ArrayList<ProviderCallUsage>();
        for (int i = 0; i < 50; i++) {
            calls.add(new ProviderCallUsage(UUID.randomUUID(), Provider.OPENAI, "gpt-6-luna", "responses.create",
                1, 1, 0, 1, BigDecimal.ZERO, BigDecimal.ZERO, true));
        }
        assertThat(cap).isEqualByComparingTo(".00003174");
        assertThat(PlatformSpendTariff.actualCost(calls, 50, PlatformSpendTariff.VERSION))
            .isEqualByComparingTo(".00003150").isLessThanOrEqualTo(cap);
    }

    @Test void singleAttemptHasNoExtraRoundingAllowanceAndHistoricalTariffsRemainPinned() {
        assertThat(PlatformSpendTariff.fullReservation(List.of("gpt-6-luna"), budget(1, 1, 1),
            PlatformSpendTariff.VERSION)).isEqualByComparingTo(".00000063");
        assertThat(PlatformSpendTariff.fullReservation(List.of("gpt-5.6-luna"), budget(4, 2000, 2000),
            PlatformSpendTariff.LEGACY_VERSION)).isEqualByComparingTo(".00290003");
        assertThatThrownBy(() -> PlatformSpendTariff.fullReservation(List.of("gpt-6-luna"), budget(1, 1, 1),
            PlatformSpendTariff.LEGACY_VERSION)).isInstanceOf(org.springframework.web.server.ResponseStatusException.class);
    }

    @Test void incompleteOrUnpricedCompletionBoundsFailClosed() {
        for (RunBudget invalid : List.of(budget(0, 1, 1), budget(1, 0, 1), budget(1, 1, 0))) {
            assertThatThrownBy(() -> PlatformSpendTariff.fullReservation(List.of("gpt-6-luna"), invalid,
                PlatformSpendTariff.VERSION)).isInstanceOf(IllegalArgumentException.class);
        }
        assertThatThrownBy(() -> PlatformSpendTariff.fullReservation(List.of(), budget(1, 1, 1),
            PlatformSpendTariff.VERSION)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> PlatformSpendTariff.fullReservation(null, budget(1, 1, 1),
            PlatformSpendTariff.VERSION)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> PlatformSpendTariff.fullReservation(List.of("gpt-6-luna"), null,
            PlatformSpendTariff.VERSION)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> PlatformSpendTariff.fullReservation(List.of("unpriced-router"), budget(1, 1, 1),
            PlatformSpendTariff.VERSION)).isInstanceOf(org.springframework.web.server.ResponseStatusException.class);
    }

    @ParameterizedTest
    @CsvSource({
        "0, .001, 0, 0, MONTHLY_POLICY_UNCONFIGURED",
        "0, .001, .02, .01, MONTHLY_POLICY_UNCONFIGURED",
        ".02, .001, .02, .04, GLOBAL_MONTH_SOFT_TARGET",
        ".03, .001, .02, .04, GLOBAL_MONTH_SOFT_TARGET",
        ".019, .022, .02, .04, GLOBAL_MONTH_HARD_LIMIT",
        ".019, .021, .02, .04, ALLOWED",
        ".019, .002, .02, .04, ALLOWED"
    })
    void monthlyGateUsesPreAdmissionSoftThresholdAndInclusiveHardBound(
            String exposure, String full, String soft, String hard, String expected) {
        var reason = PlatformSpendMonthLedger.unavailable(new BigDecimal(exposure), new BigDecimal(full),
            new BigDecimal(soft), new BigDecimal(hard));
        assertThat(reason).isEqualTo("ALLOWED".equals(expected) ? null : expected);
    }

    @ParameterizedTest
    @CsvSource({
        "2026-12-31T14:59:59Z, 2026-12-31, 2026-12-28, 2026-12-01, 2026-12-31T15:00:00Z",
        "2026-12-31T15:00:00Z, 2027-01-01, 2026-12-28, 2027-01-01, 2027-01-01T15:00:00Z",
        "2027-01-03T15:00:00Z, 2027-01-04, 2027-01-04, 2027-01-01, 2027-01-04T15:00:00Z",
        "2028-02-29T15:00:00Z, 2028-03-01, 2028-02-28, 2028-03-01, 2028-03-01T15:00:00Z"
    })
    void koreanMonthWeekAndYearBoundariesRemainIndependent(
            String instant, String day, String week, String month, String expires) {
        var period = PlatformSpendService.Period.at(Instant.parse(instant));
        assertThat(period.day()).hasToString(day);
        assertThat(period.week()).hasToString(week);
        assertThat(period.month()).hasToString(month);
        assertThat(period.validUntil()).isEqualTo(Instant.parse(expires));
    }

    @Test void completionWireRoundTripsEntireBudgetAndDefensivelyCopiesModels() {
        var models = new ArrayList<>(List.of("gpt-6-astra", "gpt-6-luna"));
        var budget = budget(7, 2345, 1234);
        var completion = new PlatformCompletionEnvelope("completion-v1", 23, models, budget);
        var payload = new PlatformBudget(UUID.randomUUID(), new BigDecimal(".09101256"), PlatformSpendTariff.VERSION,
            Instant.parse("2031-03-15T15:00:00Z"), completion);
        models.clear();
        assertThat(completion.allowedModels()).containsExactly("gpt-6-astra", "gpt-6-luna");
        assertThatThrownBy(() -> completion.allowedModels().add("gpt-5.6-luna"))
            .isInstanceOf(UnsupportedOperationException.class);
        var json = MAPPER.writeValueAsString(payload);
        assertThat(MAPPER.readValue(json, PlatformBudget.class)).isEqualTo(payload);
        assertThat(MAPPER.readTree(json).path("completion").path("budget").size()).isEqualTo(10);
        assertThat(MAPPER.readTree(json).path("completion").path("protocolVersion").asString()).isEqualTo("completion-v1");
    }

    @Test void legacyBudgetWireOmitsCompletionEntirely() {
        var budget = new PlatformBudget(UUID.randomUUID(), new BigDecimal(".17"), PlatformSpendTariff.VERSION,
            Instant.parse("2031-03-15T15:00:00Z"));
        var wire = MAPPER.writeValueAsString(budget);
        assertThat(MAPPER.readTree(wire).has("completion")).isFalse();
        assertThat(MAPPER.readValue(wire, PlatformBudget.class)).isEqualTo(budget);
    }

    @Test void malformedEnvelopesCannotAcquireCompletionMeaning() {
        var budget = budget(2, 17, 11);
        assertThatThrownBy(() -> new PlatformCompletionEnvelope("completion-v2", 1, List.of("gpt-6-luna"), budget))
            .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new PlatformCompletionEnvelope("completion-v1", 0, List.of("gpt-6-luna"), budget))
            .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new PlatformCompletionEnvelope("completion-v1", 1, List.of("gpt-6-luna", "gpt-6-luna"), budget))
            .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new PlatformCompletionEnvelope("completion-v1", 1, List.of(" "), budget))
            .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new PlatformCompletionEnvelope("completion-v1", 1, List.of(), budget))
            .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new PlatformCompletionEnvelope("completion-v1", 1, List.of("gpt-6-luna"), null))
            .isInstanceOf(IllegalArgumentException.class);
    }

    private static RunBudget budget(int calls, int input, int output) {
        return new RunBudget(90, calls, 3, input, output, 2, 1, 1, 2, 1);
    }
}
