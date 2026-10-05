package com.freelanceops.backend.domain.agentrun.service;

import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

public final class PlatformSpendUnavailableException extends ResponseStatusException {
    public PlatformSpendUnavailableException() {
        super(HttpStatus.SERVICE_UNAVAILABLE, "Platform AI spending is disabled until operator budget approval");
    }
}
