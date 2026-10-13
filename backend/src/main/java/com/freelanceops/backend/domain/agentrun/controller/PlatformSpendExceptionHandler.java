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
        String message = switch (error.scope()) {
            case "GLOBAL_MONTH_SOFT_TARGET" -> "월 운영 예산 목표에 도달해 새 작업 접수를 잠시 멈췄습니다.";
            case "GLOBAL_MONTH_HARD_LIMIT" -> "새 작업의 전체 예산을 월 한도 안에서 예약할 수 없습니다.";
            case "MONTHLY_POLICY_UNCONFIGURED" -> "월 운영 예산 설정을 확인한 후 새 작업을 접수할 수 있습니다.";
            case "MODEL_FULL_RESERVATION" -> "이 모델의 전체 작업 예산이 실행별 예약 한도를 넘습니다.";
            default -> "플랫폼 AI 비용 한도에 도달했습니다. 예산 갱신 후 다시 시도해 주세요.";
        };
        return ResponseEntity.status(error.getStatusCode())
            .body(new SpendError("PLATFORM_SPEND_EXHAUSTED", message));
    }

    @ExceptionHandler(PlatformSpendUnavailableException.class)
    public ResponseEntity<SpendError> disabled(PlatformSpendUnavailableException error) {
        return ResponseEntity.status(error.getStatusCode())
            .body(new SpendError("PLATFORM_SPEND_DISABLED", "플랫폼 AI 비용 예산 승인 전에는 분석을 시작할 수 없습니다."));
    }
}
