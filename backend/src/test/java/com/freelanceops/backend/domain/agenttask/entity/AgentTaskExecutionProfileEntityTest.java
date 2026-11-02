package com.freelanceops.backend.domain.agenttask.entity;

import static org.assertj.core.api.Assertions.assertThat;

import com.freelanceops.backend.domain.agentrun.model.AgentRunBudget;
import com.freelanceops.backend.domain.agentrun.model.Provider;
import com.freelanceops.backend.domain.agentrun.model.ReasoningEffort;
import com.freelanceops.backend.domain.agenttask.model.AgentTaskRiskLevel;
import com.freelanceops.backend.domain.agenttask.model.AgentTaskRoute;
import com.freelanceops.backend.domain.agenttask.model.AgentTaskToolProfile;

import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

class AgentTaskExecutionProfileEntityTest {
    @Test
    void revisionCopiesRetainAllHistoricalBudgetColumnsAndPolicyMetadata() {
        UUID task = UUID.randomUUID(), workspace = UUID.randomUUID(), run = UUID.randomUUID();
        var now = Instant.parse("2026-10-01T00:00:00Z");
        var budget = new AgentRunBudget(901, 51, 101, 98765, 87654, 5, 3, 101, 6, 11);
        var original = profile(task, 1, workspace, run, budget, now);
        var copied = original.copyForRevision(2, now.plusSeconds(1));

        assertThat(
                        copied.hasSameContract(
                                profile(task, 2, workspace, run, budget, now.plusSeconds(1))))
                .isTrue();
        assertThat(original.id().taskRevision()).isEqualTo(1);
        assertThat(copied.id().taskRevision()).isEqualTo(2);
    }

    private static AgentTaskExecutionProfileEntity profile(
            UUID task, int revision, UUID workspace, UUID run, AgentRunBudget budget, Instant now) {
        return new AgentTaskExecutionProfileEntity(
                new AgentTaskExecutionProfileId(task, revision),
                workspace,
                run,
                AgentTaskRoute.REACT_AGENT,
                AgentTaskRiskLevel.LOW,
                "react-read-v1",
                AgentTaskToolProfile.READ_ONLY,
                Provider.OPENAI,
                "historical-model",
                ReasoningEffort.LOW,
                List.of("agent.run", "project.read"),
                budget,
                3,
                4,
                "route-v1",
                "guard-v1",
                now);
    }
}
