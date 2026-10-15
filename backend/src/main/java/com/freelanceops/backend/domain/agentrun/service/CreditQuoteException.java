package com.freelanceops.backend.domain.agentrun.service;

import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/** 크레딧 가격이 바뀌면 클라이언트가 가격을 갱신하고 사용자에게 다시 전송 동의를 받아야 한다. */
public final class CreditQuoteException extends ResponseStatusException {
    private final String code;

    public CreditQuoteException(HttpStatus status, String code, String message) {
        super(status, message);
        this.code = code;
    }

    public String code() {
        return code;
    }
}
