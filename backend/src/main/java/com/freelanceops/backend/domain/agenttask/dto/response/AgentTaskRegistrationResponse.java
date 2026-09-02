package com.freelanceops.backend.domain.agenttask.dto.response;

import com.freelanceops.backend.domain.agenttask.entity.AgentTaskAttemptEntity;
import com.freelanceops.backend.domain.agenttask.entity.AgentTaskEntity;
import com.freelanceops.backend.domain.agenttask.entity.AgentTaskExecutionProfileEntity;

public record AgentTaskRegistrationResponse(
    AgentTaskResponse task,
    AgentTaskAttemptRegistrationResponse attempt,
    long authorizationRevision,
    long budgetRevision
) {
    public static AgentTaskRegistrationResponse from(AgentTaskEntity task, AgentTaskAttemptEntity attempt,
                                                      AgentTaskExecutionProfileEntity profile) {
        return new AgentTaskRegistrationResponse(AgentTaskResponse.from(task),
            AgentTaskAttemptRegistrationResponse.from(attempt), profile.authorizationRevision(),
            profile.budgetRevision());
    }
}
