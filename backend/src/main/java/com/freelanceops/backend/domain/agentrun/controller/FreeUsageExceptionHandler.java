package com.freelanceops.backend.domain.agentrun.controller;

import com.freelanceops.backend.domain.agentrun.dto.response.CreditQuoteErrorResponse;
import com.freelanceops.backend.domain.agentrun.dto.response.FreeUsageExhaustedResponse;
import com.freelanceops.backend.domain.agentrun.service.CreditQuoteException;
import com.freelanceops.backend.domain.agentrun.service.FreeUsageExhaustedException;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice(assignableTypes = AgentRunController.class)
public class FreeUsageExceptionHandler {

    @ExceptionHandler(CreditQuoteException.class)
    public ResponseEntity<CreditQuoteErrorResponse> quote(CreditQuoteException error) {
        return ResponseEntity.status(error.getStatusCode())
                .body(new CreditQuoteErrorResponse(error.code(), error.getReason()));
    }

    @ExceptionHandler(FreeUsageExhaustedException.class)
    public ResponseEntity<FreeUsageExhaustedResponse> exhausted(FreeUsageExhaustedException error) {
        var usage = error.usage();
        return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                .body(
                        new FreeUsageExhaustedResponse(
                                "FREE_USAGE_EXHAUSTED",
                                error.getMessage(),
                                usage.limit(),
                                usage.used(),
                                usage.reserved(),
                                usage.resetAt(),
                                error.requiredCredits(),
                                usage.remaining(),
                                "CREDITS"));
    }
}
