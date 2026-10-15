package com.freelanceops.backend.domain.identity.controller;

import com.freelanceops.backend.domain.identity.service.IdentityException;

import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice(
        assignableTypes = {
            AuthController.class,
            MeController.class,
            EmailVerificationController.class
        })
public class IdentityExceptionHandler {

    // 바인딩 예외에 비밀번호나 인증 토큰이 포함될 수 있으므로 로그와 응답에 담지 않는다.
    @ExceptionHandler({
        MethodArgumentNotValidException.class,
        HttpMessageNotReadableException.class
    })
    ProblemDetail invalidInput() {
        ProblemDetail detail =
                ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST, "Invalid identity input");
        detail.setProperty("code", "INVALID_IDENTITY_REQUEST");
        return detail;
    }

    @ExceptionHandler(IdentityException.class)
    ProblemDetail handleIdentityException(IdentityException error) {
        ProblemDetail detail = ProblemDetail.forStatus(error.status());
        detail.setTitle("Identity request rejected");
        detail.setDetail(error.code());
        detail.setProperty("code", error.code());
        return detail;
    }
}
