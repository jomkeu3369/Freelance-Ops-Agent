package com.freelanceops.backend.domain.agentrun.service;

public class FreeUsageExhaustedException extends RuntimeException {
    private final FreeUsageService.Usage usage;

    public FreeUsageExhaustedException(FreeUsageService.Usage usage) {
        super("Monthly free analysis allowance exhausted");
        this.usage = usage;
    }

    public FreeUsageService.Usage usage() { return usage; }
}
