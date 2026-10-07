package com.freelanceops.backend.domain.agentrun.service;

import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

public final class PlatformSpendExhaustedException extends ResponseStatusException {
    public PlatformSpendExhaustedException(String scope) {
        super(HttpStatus.TOO_MANY_REQUESTS, "Platform AI monetary budget is exhausted: " + scope);
    }
}
