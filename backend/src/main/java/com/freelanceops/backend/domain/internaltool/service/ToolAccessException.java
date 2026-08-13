package com.freelanceops.backend.domain.internaltool.service;

import org.springframework.http.HttpStatus;

public class ToolAccessException extends RuntimeException {

    private final HttpStatus status;
    private final String code;

    public ToolAccessException(HttpStatus status, String code) {
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


