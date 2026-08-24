package com.freelanceops.backend.global.web;

import org.springframework.dao.ConcurrencyFailureException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
public class PersistenceConflictExceptionHandler {

    @ExceptionHandler(ConcurrencyFailureException.class)
    ProblemDetail handleConcurrentModification(RuntimeException error) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(
            HttpStatus.CONFLICT,
            "The resource changed concurrently; reload it and retry the operation."
        );
        problem.setTitle("Concurrent modification");
        problem.setProperty("code", "CONCURRENT_MODIFICATION");
        return problem;
    }
}
