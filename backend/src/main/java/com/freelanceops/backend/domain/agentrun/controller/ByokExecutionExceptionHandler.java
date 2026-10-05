package com.freelanceops.backend.domain.agentrun.controller;

import com.freelanceops.backend.domain.agentrun.service.ByokExecutionException;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
public class ByokExecutionExceptionHandler {
    public record Error(String code, String message) { }
    @ExceptionHandler(ByokExecutionException.class)
    public ResponseEntity<Error> rejected(ByokExecutionException error) {
        return ResponseEntity.status(error.getStatusCode()).body(new Error(error.code(), error.getReason()));
    }
}
