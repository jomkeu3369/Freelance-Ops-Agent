package com.freelanceops.backend.domain.internaltool.security;

public class DelegationTokenException extends RuntimeException {

    public DelegationTokenException(String message) {
        super(message);
    }

    public DelegationTokenException(String message, Throwable cause) {
        super(message, cause);
    }
}


