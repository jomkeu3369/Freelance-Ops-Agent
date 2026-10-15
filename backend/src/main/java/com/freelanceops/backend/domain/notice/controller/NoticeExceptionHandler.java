package com.freelanceops.backend.domain.notice.controller;

import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice(assignableTypes = NoticeController.class)
public class NoticeExceptionHandler {
    @ExceptionHandler({
        MethodArgumentNotValidException.class,
        HttpMessageNotReadableException.class
    })
    ProblemDetail invalidInput() {
        // 거부된 초안의 내용이 검증 로그나 응답에 포함되지 않도록 한다.
        return ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST, "Invalid notice input");
    }
}
