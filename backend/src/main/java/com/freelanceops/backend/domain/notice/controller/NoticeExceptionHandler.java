package com.freelanceops.backend.domain.notice.controller;

import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice(assignableTypes = NoticeController.class)
public class NoticeExceptionHandler {
    @ExceptionHandler({MethodArgumentNotValidException.class, HttpMessageNotReadableException.class})
    ProblemDetail invalidInput() {
        // A rejected draft must not appear in framework validation logs or a reflected response.
        return ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST, "Invalid notice input");
    }
}
