package com.freelanceops.backend.domain.project.controller;

import com.freelanceops.backend.domain.project.model.ProjectDeletionInProgressException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
public class ProjectExceptionHandler {

    @ExceptionHandler(ProjectDeletionInProgressException.class)
    ProblemDetail handleDeletionInProgress(ProjectDeletionInProgressException error) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(HttpStatus.CONFLICT, error.getMessage());
        problem.setTitle("Project deletion is in progress");
        problem.setProperty("code", "PROJECT_DELETION_IN_PROGRESS");
        return problem;
    }
}
