package com.freelanceops.backend.domain.quotation.controller;

import com.freelanceops.backend.domain.quotation.dto.response.QuotationAssumptionUnavailableResponse;
import com.freelanceops.backend.domain.quotation.service.QuotationAssumptionUnavailableException;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice(assignableTypes = ProjectQuotationController.class)
public class QuotationAssumptionExceptionHandler {

    @ExceptionHandler(QuotationAssumptionUnavailableException.class)
    public ResponseEntity<QuotationAssumptionUnavailableResponse> unavailable(QuotationAssumptionUnavailableException error) {
        return ResponseEntity.status(error.getStatusCode())
                .body(
                        new QuotationAssumptionUnavailableResponse(
                                "ASSUMPTION_BUDGET_UNAVAILABLE",
                                "독립 AI 가정 제안은 예산 연결 전까지 사용할 수 없습니다. 프로젝트 분석에서 가정을 생성해 주세요."));
    }
}
