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
        48000,
        4,
        2,
        2,
        2,
        3
    );

    @Test
    void acceptsBudgetWithinOperationalCaps() {
        policy.enforce(new RunBudget(120, 12, 6, 20000, 48000, 4, 2, 1, 1, 3));
    }

    @Test
    void rejectsAnyBudgetDimensionAboveOperationalCaps() {
        assertThatThrownBy(() -> policy.enforce(
            new RunBudget(120, 5, 6, 20000, 5000, 4, 2, 3, 1, 3)
        ))
            .isInstanceOf(ResponseStatusException.class)
            .hasMessageContaining("422 UNPROCESSABLE_CONTENT");
    }
    @Test
    void separatesApprovedPersonalInputCeilingFromUnchangedPlatformCeiling() {
        policy.enforce(new RunBudget(180,12,12,50000,48000,4,2,2,2,3));
        assertThatThrownBy(() -> policy.enforce(new RunBudget(180,12,12,50001,48000,4,2,2,2,3)))
            .isInstanceOf(ResponseStatusException.class);
        policy.enforcePersonal(new RunBudget(180,12,12,150000,48000,4,2,2,2,3));
        assertThatThrownBy(() -> policy.enforcePersonal(new RunBudget(180,12,12,150001,48000,4,2,2,2,3)))
            .isInstanceOf(ResponseStatusException.class);
    }

    @Test
    void largerPersonalInputAllowanceDoesNotRaiseOtherDimensions() {
        for (var requested : java.util.List.of(
            new RunBudget(181,12,12,150000,48000,4,2,2,2,3),
            new RunBudget(180,13,12,150000,48000,4,2,2,2,3),
            new RunBudget(180,12,12,150000,48001,4,2,2,2,3),
            new RunBudget(180,12,13,150000,48000,4,2,2,2,3))) {
            assertThatThrownBy(() -> policy.enforcePersonal(requested)).isInstanceOf(ResponseStatusException.class);
        }
    }

    @Test
    void inflatedPlatformConfigurationCannotRaiseNoticeBackedPersonalCaps() {
        var inflated=new AgentBudgetPolicy(900,100,100,250000,200000,4,2,100,5,10);
        inflated.enforcePersonal(new RunBudget(180,50,12,150000,48000,4,2,2,2,3));
        for (var requested:java.util.List.of(
            new RunBudget(181,50,12,150000,48000,4,2,2,2,3),
            new RunBudget(180,51,12,150000,48000,4,2,2,2,3),
            new RunBudget(180,50,12,150000,48001,4,2,2,2,3),
            new RunBudget(180,50,12,150001,48000,4,2,2,2,3))) {
            assertThatThrownBy(() -> inflated.enforcePersonal(requested)).isInstanceOf(ResponseStatusException.class);
            inflated.enforce(requested); // Existing platform configuration semantics remain unchanged.
        }
        var lower=new AgentBudgetPolicy(90,10,12,50000,1000,4,2,2,2,3);
        lower.enforcePersonal(new RunBudget(90,10,12,150000,1000,4,2,2,2,3));
        assertThatThrownBy(() -> lower.enforcePersonal(new RunBudget(91,10,12,150000,1000,4,2,2,2,3)))
            .isInstanceOf(ResponseStatusException.class);
    }

}
