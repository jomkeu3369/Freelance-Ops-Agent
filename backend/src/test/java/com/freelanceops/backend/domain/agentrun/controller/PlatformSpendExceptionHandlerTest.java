package com.freelanceops.backend.domain.agentrun.controller;

import com.freelanceops.backend.domain.agentrun.service.PlatformSpendExhaustedException;
import com.freelanceops.backend.domain.agentrun.service.PlatformSpendUnavailableException;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.assertThat;

class PlatformSpendExceptionHandlerTest {
    private final PlatformSpendExceptionHandler handler = new PlatformSpendExceptionHandler();
    @Test void moneyExhaustionIsDistinguishedFromRefundableCreditExhaustion() {
        var result = handler.exhausted(new PlatformSpendExhaustedException("ACCOUNT_WEEK"));
        assertThat(result.getStatusCode().value()).isEqualTo(429);
        assertThat(result.getBody().code()).isEqualTo("PLATFORM_SPEND_EXHAUSTED");
    }
    @Test void disabledSpendingIsExplicit() {
        var result = handler.disabled(new PlatformSpendUnavailableException());
        assertThat(result.getStatusCode().value()).isEqualTo(503);
        assertThat(result.getBody().code()).isEqualTo("PLATFORM_SPEND_DISABLED");
    }
    @Test void monthlyAdmissionFailureExplainsTheScopeWithoutPublishingPolicyAmounts() {
        var soft = handler.exhausted(new PlatformSpendExhaustedException("GLOBAL_MONTH_SOFT_TARGET"));
        var hard = handler.exhausted(new PlatformSpendExhaustedException("GLOBAL_MONTH_HARD_LIMIT"));
        assertThat(soft.getBody().code()).isEqualTo("PLATFORM_SPEND_EXHAUSTED");
        assertThat(soft.getBody().message()).contains("월", "새 작업").doesNotContain("$");
        assertThat(hard.getBody().message()).contains("전체 예산", "월 한도");
    }
}
