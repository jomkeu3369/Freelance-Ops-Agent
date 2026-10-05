package com.freelanceops.backend.domain.agentrun.service;

import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

public final class ByokExecutionException extends ResponseStatusException {
    private final String code;
    public ByokExecutionException(HttpStatus status, String code, String message) {
        super(status, message); this.code = code;
    }
    public String code() { return code; }
}
