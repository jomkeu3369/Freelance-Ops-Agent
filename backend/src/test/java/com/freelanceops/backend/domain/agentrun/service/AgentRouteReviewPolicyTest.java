package com.freelanceops.backend.domain.agentrun.service;

import org.junit.jupiter.api.Test;

import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class AgentRouteReviewPolicyTest {
    @Test
    void alwaysRequiresSeniorReviewForRiskAndDisagreement() {
        AgentRouteReviewPolicy policy = new AgentRouteReviewPolicy(0, 0);

        assertThat(policy.reviewTarget(UUID.randomUUID(), Map.of("route", "HUMAN_REQUIRED"))).isEqualTo(3);
        assertThat(policy.reviewTarget(UUID.randomUUID(), Map.of(
            "route", "SIMPLE_LLM", "shadowSuggestedRoute", "REACT_AGENT"
        ))).isEqualTo(3);
        assertThat(policy.reviewTarget(UUID.randomUUID(), Map.of("route", "SIMPLE_LLM"))).isEqualTo(1);
    }

    @Test
    void naturalAuditCanBeRaisedToFullCoverage() {
        AgentRouteReviewPolicy policy = new AgentRouteReviewPolicy(100, 0);

        assertThat(policy.reviewTarget(UUID.randomUUID(), Map.of("route", "DIRECT_TOOL"))).isEqualTo(2);
    }

    @Test
    void defaultPolicyDeterministicallyDualReviewsHalfOfNaturalTraffic() {
        AgentRouteReviewPolicy policy = new AgentRouteReviewPolicy(50, 5);
        long reviewedAtLeastTwice = java.util.stream.LongStream.range(0, 10_000)
            .filter(value -> policy.reviewTarget(new UUID(0, value), Map.of("route", "SIMPLE_LLM")) >= 2)
            .count();
        long senior = java.util.stream.LongStream.range(0, 10_000)
            .filter(value -> policy.reviewTarget(new UUID(0, value), Map.of("route", "SIMPLE_LLM")) == 3)
            .count();

        assertThat(reviewedAtLeastTwice).isBetween(4_900L, 5_100L);
        assertThat(senior).isBetween(150L, 350L);
        UUID observationId = new UUID(10, 20);
        assertThat(policy.reviewTarget(observationId, Map.of("route", "SIMPLE_LLM")))
            .isEqualTo(policy.reviewTarget(observationId, Map.of("route", "SIMPLE_LLM")));
    }

    @Test
    void rejectsInvalidPercentage() {
        assertThatThrownBy(() -> new AgentRouteReviewPolicy(101, 5)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new AgentRouteReviewPolicy(50, 101)).isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void seniorAuditsConfiguredFractionOfDualReviewedNaturalTraffic() {
        AgentRouteReviewPolicy policy = new AgentRouteReviewPolicy(100, 5);
        long senior = java.util.stream.LongStream.range(0, 10_000)
            .filter(value -> policy.reviewTarget(new UUID(0, value), Map.of("route", "SIMPLE_LLM")) == 3)
            .count();

        assertThat(senior).isBetween(400L, 600L);
    }
}
