package com.freelanceops.backend.domain.agentrun.service;

import com.freelanceops.backend.domain.agentrun.dto.response.AgentRunView.ExternalToolCallUsage;
import java.math.BigDecimal;
import java.util.List;

/** 기본 Tavily 검색만 승인한다. 월 무료분을 가정하지 않고 공개 PAYG 상한으로 보수적으로 기록한다. */
public final class ExternalToolSpend {
    public static final BigDecimal BASIC_SEARCH_USD = new BigDecimal("0.00800000");
    private ExternalToolSpend() {}

    public static void validate(ExternalToolCallUsage call) {
        if (!"TAVILY".equals(call.provider()) || !"SEARCH_BASIC".equals(call.operation())
                || !"tavily-basic-2026-10-22-v1".equals(call.tariffVersion()) || call.credits() != 1
                || call.reservedCostUsd() == null || call.costUsd() == null
                || BASIC_SEARCH_USD.compareTo(call.reservedCostUsd()) != 0
                || BASIC_SEARCH_USD.compareTo(call.costUsd()) != 0)
            throw new IllegalArgumentException("Unapproved external tool tariff");
    }

    public static BigDecimal cost(List<ExternalToolCallUsage> calls, boolean actual) {
        BigDecimal total = BigDecimal.ZERO;
        for (var call : calls) {
            validate(call);
            if (actual && !call.usageKnown()) return null;
            total = total.add(BASIC_SEARCH_USD);
        }
        return total;
    }
}
