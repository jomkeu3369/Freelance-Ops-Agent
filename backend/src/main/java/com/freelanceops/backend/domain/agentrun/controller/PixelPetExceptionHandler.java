package com.freelanceops.backend.domain.agentrun.controller;

import com.freelanceops.backend.domain.agentrun.service.PlatformSpendExhaustedException;
import com.freelanceops.backend.domain.agentrun.service.PlatformSpendUnavailableException;

import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.server.ResponseStatusException;

@RestControllerAdvice(assignableTypes = PixelPetGenerationController.class)
public class PixelPetExceptionHandler {
    public record Error(String code, String message) {}

    @ExceptionHandler(ResponseStatusException.class)
    public ResponseEntity<Error> rejected(ResponseStatusException error) {
        String code =
                error instanceof PlatformSpendExhaustedException
                        ? "PLATFORM_SPEND_EXHAUSTED"
                        : error instanceof PlatformSpendUnavailableException
                                ? "PLATFORM_SPEND_DISABLED"
                                : error.getReason();
        if (code == null || !code.matches("(?:PET|PLATFORM)_[A-Z_]+")) code = "PET_REQUEST_FAILED";
        return ResponseEntity.status(error.getStatusCode())
                .body(new Error(code, "펫 생성을 진행하지 못했습니다. 입력은 유지됩니다."));
    }

    @ExceptionHandler({
        MethodArgumentNotValidException.class,
        HttpMessageNotReadableException.class
    })
    public ResponseEntity<Error> invalidInput() {
        return ResponseEntity.badRequest()
                .body(new Error("PET_INVALID_GENERATION", "펫 설명과 생성 요청을 확인해 주세요."));
    }
}
