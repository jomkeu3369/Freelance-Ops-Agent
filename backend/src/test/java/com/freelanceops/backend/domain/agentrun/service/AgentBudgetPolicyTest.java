package com.freelanceops.backend.domain.agentrun.service;

import com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest.RunBudget;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

import static org.assertj.core.api.Assertions.assertThatThrownBy;

class AgentBudgetPolicyTest {

    private final AgentBudgetPolicy policy = new AgentBudgetPolicy(
        180,
        12,
        12,
        50000,
        12000,
        4,
        2,
        2,
        2,
        3
    );

    @Test
    void acceptsBudgetWithinOperationalCaps() {
        policy.enforce(new RunBudget(120, 12, 6, 20000, 5000, 4, 2, 1, 1, 3));
    }

    @Test
    void rejectsAnyBudgetDimensionAboveOperationalCaps() {
        assertThatThrownBy(() -> policy.enforce(
            new RunBudget(120, 5, 6, 20000, 5000, 4, 2, 3, 1, 3)
        ))
            .isInstanceOf(ResponseStatusException.class)
            .hasMessageContaining("422 UNPROCESSABLE_CONTENT");
    }
}
