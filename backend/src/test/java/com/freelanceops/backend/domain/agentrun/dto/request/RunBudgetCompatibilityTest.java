package com.freelanceops.backend.domain.agentrun.dto.request;

import static org.assertj.core.api.Assertions.assertThat;

import com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest.RunBudget;
import com.freelanceops.backend.domain.agentrun.entity.AgentRunEntity;
import com.freelanceops.backend.domain.agentrun.model.AgentRunBudget;
import com.freelanceops.backend.domain.agentrun.model.AgentRunStatus;
import com.freelanceops.backend.domain.agentrun.model.Provider;
import com.freelanceops.backend.domain.agentrun.model.ReasoningEffort;

import org.junit.jupiter.api.Test;

import tools.jackson.databind.ObjectMapper;

import java.time.Instant;
import java.util.UUID;

class RunBudgetCompatibilityTest {
    @Test
    void allHttpBudgetFieldsSurviveTheEntityBoundaryWithoutChangingJson() {
        var json = new ObjectMapper();
        String original =
                """
                {"maxDurationSeconds":179,"maxModelCalls":49,"maxToolCalls":11,
                 "maxInputTokens":12345,"maxOutputTokens":6789,"maxDepartments":3,
                 "maxHierarchyDepth":2,"maxSearchCredits":7,"maxRetries":4,"maxHandoffs":9}
                """;
        var request = json.readValue(original, RunBudget.class);
        var run =
                new AgentRunEntity(
                        UUID.randomUUID(),
                        UUID.randomUUID(),
                        UUID.randomUUID(),
                        UUID.randomUUID(),
                        UUID.randomUUID(),
                        Provider.OPENAI,
                        "model",
                        ReasoningEffort.LOW,
                        request.toModel(),
                        AgentRunStatus.QUEUED,
                        Instant.parse("2026-10-01T00:00:00Z"));

        var restored = RunBudget.fromModel(run.budget());
        assertThat(restored).isEqualTo(request);
        assertThat(json.readTree(json.writeValueAsString(restored)))
                .isEqualTo(json.readTree(original));
    }

    @Test
    void historicalLimitsAreNotRevalidatedAsNewHttpRequests() {
        var historical = new AgentRunBudget(901, 51, 101, 98765, 87654, 5, 3, 101, 6, 11);
        assertThat(RunBudget.fromModel(historical).toModel()).isEqualTo(historical);
    }
}
