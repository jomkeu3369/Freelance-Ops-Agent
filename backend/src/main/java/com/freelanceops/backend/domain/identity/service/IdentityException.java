package com.freelanceops.backend.domain.identity.service;

import org.springframework.http.HttpStatus;

public class IdentityException extends RuntimeException {

    private final HttpStatus status;
    private final String code;

    public IdentityException(HttpStatus status, String code) {
        super(code);
        this.status = status;
        this.code = code;
    }

    public HttpStatus status() {
        return status;
    }

    public String code() {
        return code;
    }
}
