package com.freelanceops.backend.domain.agentrun.service;

import com.freelanceops.backend.domain.agentrun.dto.response.FreeUsageResponse;

public class FreeUsageExhaustedException extends RuntimeException {
    private final FreeUsageResponse usage;
    private final int requiredCredits;

    public FreeUsageExhaustedException(FreeUsageResponse usage) {
        this(usage, 0);
    }

    public FreeUsageExhaustedException(FreeUsageResponse usage, int requiredCredits) {
        super("Not enough weekly credits for the selected model");
        this.usage = usage;
        this.requiredCredits = requiredCredits;
    }

    public FreeUsageResponse usage() {
        return usage;
    }

    public int requiredCredits() {
        return requiredCredits;
    }
}
