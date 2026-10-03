package com.freelanceops.backend.domain.agentrun.controller;

import com.freelanceops.backend.domain.agentrun.service.FreeUsageExhaustedException;
import com.freelanceops.backend.domain.agentrun.service.FreeUsageService;
import org.junit.jupiter.api.Test;
import java.time.Instant;
import static org.assertj.core.api.Assertions.assertThat;

class FreeUsageExceptionHandlerTest {
    @Test void returnsExplicitCodeAndSafeQuotaMetadata() {
        var reset = Instant.parse("2026-10-31T15:00:00Z");
        var error = new FreeUsageExhaustedException(new FreeUsageService.Usage(5, 4, 1, 0, reset, "2026-10", "Asia/Seoul", 0, false));
        var response = new FreeUsageExceptionHandler().exhausted(error);
        assertThat(response.getStatusCode().value()).isEqualTo(429);
        assertThat(response.getBody().code()).isEqualTo("FREE_USAGE_EXHAUSTED");
        assertThat(response.getBody().used()).isEqualTo(4);
        assertThat(response.getBody().reserved()).isOne();
        assertThat(response.getBody().resetAt()).isEqualTo(reset);
    }
}
