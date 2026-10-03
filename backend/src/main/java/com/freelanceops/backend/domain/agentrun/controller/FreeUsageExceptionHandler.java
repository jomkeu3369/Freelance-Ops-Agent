package com.freelanceops.backend.domain.agentrun.controller;

import com.freelanceops.backend.domain.agentrun.service.FreeUsageExhaustedException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.time.Instant;

@RestControllerAdvice(assignableTypes = AgentRunController.class)
public class FreeUsageExceptionHandler {
    public record Exhausted(String code, String message, int limit, int used, int reserved, Instant resetAt) { }
    @ExceptionHandler(FreeUsageExhaustedException.class)
    public ResponseEntity<Exhausted> exhausted(FreeUsageExhaustedException error) {
        var usage = error.usage();
        return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS).body(new Exhausted("FREE_USAGE_EXHAUSTED",
            error.getMessage(), usage.limit(), usage.used(), usage.reserved(), usage.resetAt()));
    }
}
