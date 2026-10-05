package com.freelanceops.backend.domain.agentrun.service;

import com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest.ModelSelection;
import com.freelanceops.backend.domain.agentrun.model.Provider;
import com.freelanceops.backend.domain.agentrun.model.ReasoningEffort;
import org.junit.jupiter.api.Test;
import java.time.Instant;
import java.util.UUID;
import static org.assertj.core.api.Assertions.*;

class ByokCostNoticePolicyTest {
    private final Instant now=Instant.parse("2026-10-05T00:00:00Z");
    private ModelSelection selection(String model) { return new ModelSelection(Provider.OPENAI,model,ReasoningEffort.LOW,UUID.randomUUID()); }
    @Test void requiresExactCurrentNoticeVersionWithoutTrustingClientPrices() {
        for (String stale:new String[]{null,"","old-notice","byok-standard-150k-48k-2026-10-05-v2"}) {
            assertThatThrownBy(() -> ByokCostNoticePolicy.deadline(stale,selection("gpt-6-luna"),now,180))
                .isInstanceOf(ByokExecutionException.class)
                .extracting(e -> ((ByokExecutionException)e).code()).isEqualTo("BYOK_COST_NOTICE_REFRESH_REQUIRED");
        }
        assertThat(ByokCostNoticePolicy.deadline(ByokCostNoticePolicy.VERSION,selection("gpt-6-luna"),now,180))
            .isEqualTo(now.plusSeconds(180));
        assertThatThrownBy(() -> ByokCostNoticePolicy.deadline(ByokCostNoticePolicy.VERSION,selection("unapproved-model"),now,180))
            .isInstanceOf(org.springframework.web.server.ResponseStatusException.class);
    }
    @Test void noticeBackedScopeCannotCrossTheKnownPromotionalReviewBoundary() {
        var review=PlatformSpendTariff.PROMOTION_REVIEW_AT;
        assertThat(ByokCostNoticePolicy.deadline(ByokCostNoticePolicy.VERSION,selection("gpt-5.6-sol"),review.minusSeconds(30),180))
            .isEqualTo(review);
        assertThatThrownBy(() -> ByokCostNoticePolicy.deadline(ByokCostNoticePolicy.VERSION,selection("gpt-5.6-sol"),review,180))
            .isInstanceOf(ByokExecutionException.class);
    }
}
