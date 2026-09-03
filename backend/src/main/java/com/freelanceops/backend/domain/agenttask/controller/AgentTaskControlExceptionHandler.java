package com.freelanceops.backend.domain.agenttask.controller;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice(assignableTypes = AgentTaskControlController.class)
public class AgentTaskControlExceptionHandler {

    @ExceptionHandler({IllegalStateException.class, DataIntegrityViolationException.class})
    ProblemDetail conflict(RuntimeException error) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(HttpStatus.CONFLICT,
            "The Task registration or execution contract conflicts with the current state.");
        problem.setTitle("Task contract conflict");
        problem.setProperty("code", "TASK_CONTRACT_CONFLICT");
        return problem;
    }

    @ExceptionHandler(IllegalArgumentException.class)
    ProblemDetail invalidRequest(IllegalArgumentException error) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST,
            "The Task request contains an invalid identity or contract.");
        problem.setTitle("Invalid Task request");
        problem.setProperty("code", "TASK_REQUEST_INVALID");
        return problem;
    }
}
