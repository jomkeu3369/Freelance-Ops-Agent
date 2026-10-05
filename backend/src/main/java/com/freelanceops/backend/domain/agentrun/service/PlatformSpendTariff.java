package com.freelanceops.backend.domain.agentrun.service;

import com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest.ModelSelection;
import com.freelanceops.backend.domain.agentrun.dto.response.AgentRunView.ProviderCallUsage;
import com.freelanceops.backend.domain.agentrun.model.Provider;
import com.freelanceops.backend.domain.agentrun.model.ReasoningEffort;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.util.List;
import java.util.Map;

/** Immutable Standard text tariffs; see docs/testing/model-catalog-2026-10-05.md.
 * Historical versions remain interpretable for replay, resume and settlement.
 */
public final class PlatformSpendTariff {
    public static final String LEGACY_VERSION = "platform-ai-2026-10-04-v1";
    public static final String VERSION = "platform-ai-2026-10-05-v2";
    public static final String MODEL_IDS = "gpt-6-luna,gpt-6-sol,gpt-6.1-sol,gpt-6-astra,gpt-5.6-luna,gpt-5.6-terra,gpt-5.6-sol";
    public static final Instant PROMOTION_REVIEW_AT = Instant.parse("2026-11-22T00:00:00Z");
    private static final BigDecimal MILLION = new BigDecimal("1000000");
    public record Tariff(BigDecimal input, BigDecimal cachedRead, BigDecimal cacheWrite, BigDecimal output) { }
    private static Tariff rate(String input, String cached, String written, String output) {
        return new Tariff(new BigDecimal(input), new BigDecimal(cached), new BigDecimal(written), new BigDecimal(output));
    }
    private static final Map<String, Tariff> LEGACY = Map.of(
        "gpt-5.6-luna", rate(".20", ".02", ".25", "1.20"),
        "gpt-5.6-terra", rate("2", ".20", "2.50", "12"));
    private static final Map<String, Tariff> CURRENT = Map.of(
        "gpt-6-luna", rate(".10", ".01", ".125", ".50"),
        "gpt-6-sol", rate("2", ".20", "2.50", "10"),
        "gpt-6.1-sol", rate("2", ".10", "2.50", "10"),
        "gpt-6-astra", rate("10", "1", "12.50", "50"),
        "gpt-5.6-luna", LEGACY.get("gpt-5.6-luna"),
        "gpt-5.6-terra", LEGACY.get("gpt-5.6-terra"),
        "gpt-5.6-sol", rate("4", ".40", "5", "20"));
    private static final Map<String, Map<String, Tariff>> VERSIONS = Map.of(LEGACY_VERSION, LEGACY, VERSION, CURRENT);
    private PlatformSpendTariff() { }

    public static void requirePriceable(Provider provider, String model) { tariff(provider, model, VERSION); }
    public static Tariff tariff(Provider provider, String model, String version) {
        Tariff rate = VERSIONS.getOrDefault(version == null ? "" : version, Map.of()).get(model);
        if (provider != Provider.OPENAI || rate == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Model has no approved platform monetary tariff");
        }
        return rate;
    }
    public static void validateSelection(ModelSelection selection) {
        requirePriceable(selection.provider(), selection.model());
        if (selection.reasoningEffort() == ReasoningEffort.NONE
            && List.of("gpt-6.1-sol", "gpt-6-astra").contains(selection.model())) {
            throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_CONTENT, "Selected model requires LOW, MEDIUM or HIGH reasoning");
        }
    }
    public static void requireCurrentPrice(String model, Instant now) {
        if ("gpt-5.6-sol".equals(model) && !now.isBefore(PROMOTION_REVIEW_AT)) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Model promotional tariff requires operator review");
        }
    }
    public static BigDecimal calculate(ProviderCallUsage call) { return calculate(call, VERSION); }
    public static BigDecimal calculate(ProviderCallUsage call, String version) {
        tariff(call.provider(), call.model(), version);
        return call.usageKnown() ? priceTokens(call, version) : null;
    }
    private static BigDecimal priceTokens(ProviderCallUsage call, String version) {
        Tariff rate = tariff(call.provider(), call.model(), version);
        if (call.inputTokens() > 272000) throw new IllegalArgumentException("Long context is unpriced");
        long regularInput = call.inputTokens() - call.cachedReadTokens() - call.cacheWriteTokens();
        if (regularInput < 0) throw new IllegalArgumentException("Cached tokens exceed call input tokens");
        // Provider output_tokens already includes reasoning tokens.
        return BigDecimal.valueOf(regularInput).multiply(rate.input())
            .add(BigDecimal.valueOf(call.cachedReadTokens()).multiply(rate.cachedRead()))
            .add(BigDecimal.valueOf(call.cacheWriteTokens()).multiply(rate.cacheWrite()))
            .add(BigDecimal.valueOf(call.outputTokens()).multiply(rate.output()))
            .divide(MILLION, 8, RoundingMode.CEILING);
    }
    public static BigDecimal conservativeCost(List<ProviderCallUsage> calls, long count, String version) {
        return cost(calls, count, version, true);
    }
    public static BigDecimal actualCost(List<ProviderCallUsage> calls, long count, String version) {
        return cost(calls, count, version, false);
    }
    private static BigDecimal cost(List<ProviderCallUsage> calls, long count, String version, boolean conservative) {
        if (version == null || !VERSIONS.containsKey(version) || calls == null || calls.size() != count) return null;
        if (calls.stream().map(ProviderCallUsage::callId).distinct().count() != count) return null;
        BigDecimal sum = BigDecimal.ZERO;
        for (ProviderCallUsage call : calls) {
            if ("BYOK".equals(call.fundingSource())) continue;
            try {
                BigDecimal priced = priceTokens(call, version);
                if (!call.usageKnown() && !conservative) return null;
                sum = sum.add(call.usageKnown() ? priced : call.reservedCostUsd().max(priced));
            } catch (ResponseStatusException | IllegalArgumentException invalid) { return null; }
        }
        return sum.setScale(8, RoundingMode.CEILING);
    }
}
