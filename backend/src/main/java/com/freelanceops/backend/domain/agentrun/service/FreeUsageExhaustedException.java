package com.freelanceops.backend.domain.agentrun.service;

public class FreeUsageExhaustedException extends RuntimeException {
    private final FreeUsageService.Usage usage;
    private final int requiredCredits;
    public FreeUsageExhaustedException(FreeUsageService.Usage usage) { this(usage, 0); }
    public FreeUsageExhaustedException(FreeUsageService.Usage usage, int requiredCredits) {
        super("Not enough weekly credits for the selected model");
        this.usage = usage; this.requiredCredits = requiredCredits;
    }
    public FreeUsageService.Usage usage() { return usage; }
    public int requiredCredits() { return requiredCredits; }
}
