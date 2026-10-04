package com.freelanceops.backend.domain.agentrun.service;

import com.freelanceops.backend.domain.agentrun.dto.response.AgentRunView.ProviderCallUsage;
import com.freelanceops.backend.domain.agentrun.model.Provider;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.List;

/** Operator-owned tariff. Never consults user-editable workspace model_pricing.
 * Sources: https://developers.openai.com/api/docs/models/gpt-5.6-luna
 * and https://developers.openai.com/api/docs/models/gpt-5.6-terra (2026-10-04).
 */
public final class PlatformSpendTariff {
    private static final BigDecimal MILLION = new BigDecimal("1000000");
    private PlatformSpendTariff() { }

    public static void requirePriceable(Provider provider, String model) {
        if (provider != Provider.OPENAI || !("gpt-5.6-luna".equals(model) || "gpt-5.6-terra".equals(model))) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Model has no approved platform monetary tariff");
        }
    }

    public static BigDecimal calculate(ProviderCallUsage call) {
        requirePriceable(call.provider(), call.model());
        if (!call.usageKnown()) return null;
        return priceTokens(call);
    }

    private static BigDecimal priceTokens(ProviderCallUsage call) {
        requirePriceable(call.provider(), call.model());
        BigDecimal multiplier = "gpt-5.6-luna".equals(call.model()) ? BigDecimal.ONE : BigDecimal.TEN;
        long regularInput = call.inputTokens() - call.cachedReadTokens() - call.cacheWriteTokens();
        if (regularInput < 0) throw new IllegalArgumentException("Cached tokens exceed call input tokens");
        return BigDecimal.valueOf(regularInput).multiply(new BigDecimal("0.20"))
            .add(BigDecimal.valueOf(call.cachedReadTokens()).multiply(new BigDecimal("0.02")))
            .add(BigDecimal.valueOf(call.cacheWriteTokens()).multiply(new BigDecimal("0.25")))
            .add(BigDecimal.valueOf(call.outputTokens()).multiply(new BigDecimal("1.20")))
            .multiply(multiplier).divide(MILLION, 8, RoundingMode.CEILING);
    }

    /** An unknown attempt consumes its reserved upper bound instead of being shown as free. */
    public static BigDecimal conservativeCost(List<ProviderCallUsage> calls, long reportedModelCalls, String tariffVersion) {
        if (!PlatformSpendService.TARIFF_VERSION.equals(tariffVersion) || calls == null
            || calls.size() != reportedModelCalls) return null;
        BigDecimal sum = BigDecimal.ZERO;
        for (ProviderCallUsage call : calls) {
            if ("BYOK".equals(call.fundingSource())) continue;
            BigDecimal pricedTokens;
            try { pricedTokens = priceTokens(call); }
            catch (ResponseStatusException ignored) { return null; }
            // Bound drift is still an unknown/failed attempt, but any higher observed
            // token cost must not disappear behind its smaller original reservation.
            sum = sum.add(call.usageKnown() ? pricedTokens : call.reservedCostUsd().max(pricedTokens));
        }
        return sum.setScale(8, RoundingMode.CEILING);
    }

    /** Unknown attempts keep the entire run unpriced; zero usage is never inferred from failure. */
    public static BigDecimal actualCost(List<ProviderCallUsage> calls, long reportedModelCalls, String tariffVersion) {
        if (!PlatformSpendService.TARIFF_VERSION.equals(tariffVersion) || calls == null
            || calls.size() != reportedModelCalls) return null;
        BigDecimal sum = BigDecimal.ZERO;
        for (ProviderCallUsage call : calls) {
            if ("BYOK".equals(call.fundingSource())) continue;
            BigDecimal cost;
            try { cost = calculate(call); }
            catch (ResponseStatusException ignored) { return null; }
            if (cost == null) return null;
            sum = sum.add(cost);
        }
        return sum.setScale(8, RoundingMode.CEILING);
    }
}
