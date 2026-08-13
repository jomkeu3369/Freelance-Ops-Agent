package com.freelanceops.backend.domain.identity.controller;

import com.freelanceops.backend.domain.identity.service.IdentityException;
import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice(assignableTypes = {AuthController.class, MeController.class})
public class IdentityExceptionHandler {

    @ExceptionHandler(IdentityException.class)
    ProblemDetail handleIdentityException(IdentityException error) {
        ProblemDetail detail = ProblemDetail.forStatus(error.status());
        detail.setTitle("Identity request rejected");
        detail.setDetail(error.code());
        detail.setProperty("code", error.code());
        return detail;
    }
}
