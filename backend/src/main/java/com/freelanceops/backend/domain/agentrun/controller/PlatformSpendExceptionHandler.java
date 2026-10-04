package com.freelanceops.backend.domain.agentrun.controller;

import com.freelanceops.backend.domain.agentrun.service.PlatformSpendExhaustedException;
import com.freelanceops.backend.domain.agentrun.service.PlatformSpendUnavailableException;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice(assignableTypes = AgentRunController.class)
public class PlatformSpendExceptionHandler {
    public record SpendError(String code, String message) { }

    @ExceptionHandler(PlatformSpendExhaustedException.class)
    public ResponseEntity<SpendError> exhausted(PlatformSpendExhaustedException error) {
        return ResponseEntity.status(error.getStatusCode())
            .body(new SpendError("PLATFORM_SPEND_EXHAUSTED", "플랫폼 AI 비용 한도에 도달했습니다. 예산 갱신 후 다시 시도해 주세요."));
    }

    @ExceptionHandler(PlatformSpendUnavailableException.class)
    public ResponseEntity<SpendError> disabled(PlatformSpendUnavailableException error) {
        return ResponseEntity.status(error.getStatusCode())
            .body(new SpendError("PLATFORM_SPEND_DISABLED", "플랫폼 AI 비용 예산 승인 전에는 분석을 시작할 수 없습니다."));
    }
}
