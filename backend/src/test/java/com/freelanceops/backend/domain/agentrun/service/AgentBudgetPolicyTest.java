package com.freelanceops.backend.domain.agentrun.service;

import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest.RunBudget;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.ConfigDataApplicationContextInitializer;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.web.server.ResponseStatusException;

class AgentBudgetPolicyTest {

    private final AgentBudgetPolicy policy =
            new AgentBudgetPolicy(180, 12, 12, 50000, 48000, 4, 2, 2, 2, 3);

    @Test
    void defaultPolicyAllowsFullAnalysisInputButRejectsOneTokenAboveItsCeiling() {
        new ApplicationContextRunner()
                .withUserConfiguration(AgentBudgetPolicy.class)
                .run(
                        context -> {
                            var defaults = context.getBean(AgentBudgetPolicy.class);
                            defaults.enforce(
                                    new RunBudget(180, 50, 12, 100000, 48000, 4, 2, 2, 2, 3));
                            assertThatThrownBy(
                                            () ->
                                                    defaults.enforce(
                                                            new RunBudget(
                                                                    180, 50, 12, 100001, 48000, 4,
                                                                    2, 2, 2, 3)))
                                    .isInstanceOf(ResponseStatusException.class)
                                    .hasMessageContaining("422 UNPROCESSABLE_CONTENT");
                        });
    }

    @Test
    void applicationConfigurationKeepsAnExplicitLowerOperatorInputQuota() {
        var application =
                new ApplicationContextRunner()
                        .withInitializer(new ConfigDataApplicationContextInitializer())
                        .withUserConfiguration(AgentBudgetPolicy.class);
        application.run(
                context ->
                        context.getBean(AgentBudgetPolicy.class)
                                .enforce(
                                        new RunBudget(
                                                180, 50, 12, 100000, 48000, 4, 2, 2, 2, 3)));
        application
                .withPropertyValues("AGENT_QUOTA_MAX_INPUT_TOKENS=50000")
                .run(
                        context -> {
                            var configured = context.getBean(AgentBudgetPolicy.class);
                            configured.enforce(
                                    new RunBudget(180, 50, 12, 50000, 48000, 4, 2, 2, 2, 3));
                            assertThatThrownBy(
                                            () ->
                                                    configured.enforce(
                                                            new RunBudget(
                                                                    180, 50, 12, 50001, 48000, 4, 2,
                                                                    2, 2, 3)))
                                    .isInstanceOf(ResponseStatusException.class);
                        });
    }

    @Test
    void acceptsBudgetWithinOperationalCaps() {
        policy.enforce(new RunBudget(120, 12, 6, 20000, 48000, 4, 2, 1, 1, 3));
    }

    @Test
    void rejectsAnyBudgetDimensionAboveOperationalCaps() {
        assertThatThrownBy(
                        () -> policy.enforce(new RunBudget(120, 5, 6, 20000, 5000, 4, 2, 3, 1, 3)))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("422 UNPROCESSABLE_CONTENT");
    }

    @Test
    void separatesApprovedPersonalInputCeilingFromConfiguredPlatformCeiling() {
        policy.enforce(new RunBudget(180, 12, 12, 50000, 48000, 4, 2, 2, 2, 3));
        assertThatThrownBy(
                        () ->
                                policy.enforce(
                                        new RunBudget(180, 12, 12, 50001, 48000, 4, 2, 2, 2, 3)))
                .isInstanceOf(ResponseStatusException.class);
        policy.enforcePersonal(new RunBudget(180, 12, 12, 150000, 48000, 4, 2, 2, 2, 3));
        assertThatThrownBy(
                        () ->
                                policy.enforcePersonal(
                                        new RunBudget(180, 12, 12, 150001, 48000, 4, 2, 2, 2, 3)))
                .isInstanceOf(ResponseStatusException.class);
    }

    @Test
    void largerPersonalInputAllowanceDoesNotRaiseOtherDimensions() {
        for (var requested :
                java.util.List.of(
                        new RunBudget(181, 12, 12, 150000, 48000, 4, 2, 2, 2, 3),
                        new RunBudget(180, 13, 12, 150000, 48000, 4, 2, 2, 2, 3),
                        new RunBudget(180, 12, 12, 150000, 48001, 4, 2, 2, 2, 3),
                        new RunBudget(180, 12, 13, 150000, 48000, 4, 2, 2, 2, 3))) {
            assertThatThrownBy(() -> policy.enforcePersonal(requested))
                    .isInstanceOf(ResponseStatusException.class);
        }
    }

    @Test
    void inflatedPlatformConfigurationCannotRaiseNoticeBackedPersonalCaps() {
        var inflated = new AgentBudgetPolicy(900, 100, 100, 250000, 200000, 4, 2, 100, 5, 10);
        inflated.enforcePersonal(new RunBudget(180, 50, 12, 150000, 48000, 4, 2, 2, 2, 3));
        for (var requested :
                java.util.List.of(
                        new RunBudget(181, 50, 12, 150000, 48000, 4, 2, 2, 2, 3),
                        new RunBudget(180, 51, 12, 150000, 48000, 4, 2, 2, 2, 3),
                        new RunBudget(180, 50, 12, 150000, 48001, 4, 2, 2, 2, 3),
                        new RunBudget(180, 50, 12, 150001, 48000, 4, 2, 2, 2, 3))) {
            assertThatThrownBy(() -> inflated.enforcePersonal(requested))
                    .isInstanceOf(ResponseStatusException.class);
            inflated.enforce(requested); // 기존 플랫폼 실행 한도의 설정 해석을 유지한다.
        }
        var lower = new AgentBudgetPolicy(90, 10, 12, 50000, 1000, 4, 2, 2, 2, 3);
        lower.enforcePersonal(new RunBudget(90, 10, 12, 150000, 1000, 4, 2, 2, 2, 3));
        assertThatThrownBy(
                        () ->
                                lower.enforcePersonal(
                                        new RunBudget(91, 10, 12, 150000, 1000, 4, 2, 2, 2, 3)))
                .isInstanceOf(ResponseStatusException.class);
    }
}
