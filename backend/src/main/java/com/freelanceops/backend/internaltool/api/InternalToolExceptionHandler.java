package com.freelanceops.backend.internaltool.api;

import com.freelanceops.backend.internaltool.application.ToolAccessException;
import jakarta.validation.ConstraintViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.net.URI;

@RestControllerAdvice(assignableTypes = InternalToolController.class)
public class InternalToolExceptionHandler {

    @ExceptionHandler(ToolAccessException.class)
    public ResponseEntity<ProblemDetail> handleAccess(ToolAccessException error) {
        return ResponseEntity.status(error.status()).body(problem(error.status(), error.code()));
    }

    @ExceptionHandler({MethodArgumentNotValidException.class, ConstraintViolationException.class})
    public ResponseEntity<ProblemDetail> handleInvalidInput(Exception error) {
        return ResponseEntity.badRequest().body(problem(HttpStatus.BAD_REQUEST, "TOOL_INPUT_INVALID"));
    }

    private static ProblemDetail problem(HttpStatus status, String code) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(status, code);
        problem.setType(URI.create("about:blank"));
        problem.setTitle(status.getReasonPhrase());
        problem.setProperty("code", code);
        return problem;
    }
}
