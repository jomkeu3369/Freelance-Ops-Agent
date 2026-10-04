package com.freelanceops.backend.domain.agentrun.service;

import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/** Stable client contract; the client must refresh and obtain a new deliberate Send. */
public final class CreditQuoteException extends ResponseStatusException {
    private final String code;
    public CreditQuoteException(HttpStatus status, String code, String message) {
        super(status, message); this.code = code;
    }
    public String code() { return code; }
}
