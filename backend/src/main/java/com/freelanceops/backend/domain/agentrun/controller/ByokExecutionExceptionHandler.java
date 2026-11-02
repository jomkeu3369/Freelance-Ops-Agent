package com.freelanceops.backend.domain.agentrun.controller;

import com.freelanceops.backend.domain.agentrun.dto.response.ByokExecutionErrorResponse;
import com.freelanceops.backend.domain.agentrun.service.ByokExecutionException;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
public class ByokExecutionExceptionHandler {

    @ExceptionHandler(ByokExecutionException.class)
    public ResponseEntity<ByokExecutionErrorResponse> rejected(ByokExecutionException error) {
        return ResponseEntity.status(error.getStatusCode())
                .body(new ByokExecutionErrorResponse(error.code(), error.getReason()));
    }
}
