package com.freelanceops.backend.domain.agenttask.entity;

import com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest;
import com.freelanceops.backend.domain.agentrun.model.Provider;
import com.freelanceops.backend.domain.agentrun.model.ReasoningEffort;
import com.freelanceops.backend.domain.agenttask.model.AgentTaskRiskLevel;
import com.freelanceops.backend.domain.agenttask.model.AgentTaskRoute;
import com.freelanceops.backend.domain.agenttask.model.AgentTaskToolProfile;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class AgentTaskExecutionProfileEntityTest {

    private final AgentTaskExecutionProfileId id = new AgentTaskExecutionProfileId(UUID.randomUUID(), 1);
    private final UUID workspaceId = UUID.randomUUID();
    private final UUID runId = UUID.randomUUID();

    @Test
    void reorderedPermissionsAreTheSameContract() {
        var first = profile(List.of("project.read", "agent.run"));
        var reordered = profile(List.of("agent.run", "project.read"));
        assertThat(first.permissions()).containsExactly("agent.run", "project.read");
        assertThat(first.hasSameContract(reordered)).isTrue();
    }

    @Test
    void duplicatePermissionsRemainInvalid() {
        assertThatThrownBy(() -> profile(List.of("agent.run", "agent.run")))
            .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("unique");
    }

    private AgentTaskExecutionProfileEntity profile(List<String> permissions) {
        var budget = new StartAgentRunRequest.RunBudget(60, 2, 2, 1000, 1000, 1, 1, 1, 0, 0);
        return new AgentTaskExecutionProfileEntity(id, workspaceId, runId, AgentTaskRoute.REACT_AGENT,
            AgentTaskRiskLevel.LOW, "test-model", AgentTaskToolProfile.READ_ONLY, Provider.OPENAI, "gpt-test",
            ReasoningEffort.LOW, permissions, budget, 1, 1, "route-v1", "guard-v1", Instant.EPOCH);
    }
}
