package com.freelanceops.backend.domain.agentrun.controller;

import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice(assignableTypes = AIConnectionController.class)
public class AIConnectionExceptionHandler {
    // 바인딩 예외에는 입력한 API 키가 포함될 수 있으므로 로그나 응답에 담지 않는다.
    @ExceptionHandler({
        MethodArgumentNotValidException.class,
        HttpMessageNotReadableException.class
    })
    public ResponseEntity<ProblemDetail> invalidInput() {
        return ResponseEntity.badRequest()
                .body(
                        ProblemDetail.forStatusAndDetail(
                                org.springframework.http.HttpStatus.BAD_REQUEST,
                                "Invalid AI connection input"));
    }
}
