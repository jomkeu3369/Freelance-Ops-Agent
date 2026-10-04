package com.freelanceops.backend.domain.agentrun.controller;

import com.freelanceops.backend.domain.agentrun.service.FreeUsageExhaustedException;
import com.freelanceops.backend.domain.agentrun.service.CreditQuoteException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.time.Instant;

@RestControllerAdvice(assignableTypes = AgentRunController.class)
public class FreeUsageExceptionHandler {
    public record Exhausted(String code, String message, int limit, int used, int reserved, Instant resetAt, int requiredCredits, int remaining, String unit) { }
    public record QuoteError(String code, String message) { }
    @ExceptionHandler(CreditQuoteException.class)
    public ResponseEntity<QuoteError> quote(CreditQuoteException error) {
        return ResponseEntity.status(error.getStatusCode()).body(new QuoteError(error.code(), error.getReason()));
    }
    @ExceptionHandler(FreeUsageExhaustedException.class)
    public ResponseEntity<Exhausted> exhausted(FreeUsageExhaustedException error) {
        var usage = error.usage();
        return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS).body(new Exhausted("FREE_USAGE_EXHAUSTED",
            error.getMessage(), usage.limit(), usage.used(), usage.reserved(), usage.resetAt(), error.requiredCredits(), usage.remaining(), "CREDITS"));
    }
}
