package com.freelanceops.backend.domain.agenttask.controller;

import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;

import static org.assertj.core.api.Assertions.assertThat;

class AgentTaskControlExceptionHandlerTest {

    private final AgentTaskControlExceptionHandler handler = new AgentTaskControlExceptionHandler();

    @Test
    void contractAndConstraintConflictsReturn409WithoutLeakingDatabaseDetails() {
        assertThat(handler.conflict(new IllegalStateException("contract changed")).getStatus()).isEqualTo(409);
        var problem = handler.conflict(new DataIntegrityViolationException("private database detail"));
        assertThat(problem.getStatus()).isEqualTo(409);
        assertThat(problem.getDetail()).doesNotContain("private database detail");
    }

    @Test
    void invalidIdentityReturns400() {
        assertThat(handler.invalidRequest(new IllegalArgumentException("invalid parent")).getStatus()).isEqualTo(400);
    }
}
