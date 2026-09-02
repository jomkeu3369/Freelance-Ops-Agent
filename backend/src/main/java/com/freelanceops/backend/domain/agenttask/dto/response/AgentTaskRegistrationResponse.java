package com.freelanceops.backend.domain.agenttask.dto.response;

import com.freelanceops.backend.domain.agenttask.entity.AgentTaskEntity;
import com.freelanceops.backend.domain.agenttask.entity.AgentTaskExecutionProfileEntity;

public record AgentTaskRegistrationResponse(
    AgentTaskResponse task,
    long authorizationRevision,
    long budgetRevision
) {
    public static AgentTaskRegistrationResponse from(AgentTaskEntity task, AgentTaskExecutionProfileEntity profile) {
        return new AgentTaskRegistrationResponse(AgentTaskResponse.from(task), profile.authorizationRevision(),
            profile.budgetRevision());
    }
}
