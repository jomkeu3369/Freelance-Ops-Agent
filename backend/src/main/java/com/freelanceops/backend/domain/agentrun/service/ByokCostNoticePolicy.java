package com.freelanceops.backend.domain.agentrun.service;

import com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest.ModelSelection;

import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;

/** 개인 키로 새 실행을 시작하려면 최신 비용 안내에 동의해야 한다. 금액은 서버에서 계산한다. */
public final class ByokCostNoticePolicy {
    public static final String VERSION = "byok-standard-150k-48k-2026-10-05-v1";

    private ByokCostNoticePolicy() {}

    static Instant deadline(
            String version, ModelSelection selection, Instant now, int durationSeconds) {
        if (!VERSION.equals(version)) throw refreshRequired();
        PlatformSpendTariff.validateSelection(selection);
        try {
            PlatformSpendTariff.requireCurrentPrice(selection.model(), now);
        } catch (ResponseStatusException expired) {
            throw refreshRequired();
        }
        Instant deadline = now.plusSeconds(durationSeconds);
        // 검토한 할인 단가의 유효 기간이 지나면 해당 비용 안내로 호출을 승인하지 않는다.
        if ("gpt-5.6-sol".equals(selection.model())
                && deadline.isAfter(PlatformSpendTariff.PROMOTION_REVIEW_AT))
            return PlatformSpendTariff.PROMOTION_REVIEW_AT;
        return deadline;
    }

    private static ByokExecutionException refreshRequired() {
        return new ByokExecutionException(
                HttpStatus.CONFLICT,
                "BYOK_COST_NOTICE_REFRESH_REQUIRED",
                "Refresh the page and review the current personal AI cost notice before starting a new run");
    }
}
