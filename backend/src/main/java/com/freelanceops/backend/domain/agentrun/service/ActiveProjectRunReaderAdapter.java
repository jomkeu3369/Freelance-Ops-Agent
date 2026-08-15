package com.freelanceops.backend.domain.agentrun.service;

import com.freelanceops.backend.domain.agentrun.model.AgentRunStatus;
import com.freelanceops.backend.domain.agentrun.repository.AgentRunRepository;
import com.freelanceops.backend.domain.project.service.ActiveProjectRunReader;
import org.springframework.stereotype.Component;

import java.util.EnumSet;
import java.util.UUID;

@Component
public class ActiveProjectRunReaderAdapter implements ActiveProjectRunReader {

    private static final EnumSet<AgentRunStatus> ACTIVE_STATUSES = EnumSet.of(
        AgentRunStatus.QUEUED,
        AgentRunStatus.RUNNING,
        AgentRunStatus.WAITING_FOR_USER
    );

    private final AgentRunRepository agentRunRepository;

    public ActiveProjectRunReaderAdapter(AgentRunRepository agentRunRepository) {
        this.agentRunRepository = agentRunRepository;
    }

    @Override
    public boolean exists(UUID workspaceId, UUID projectId) {
        return agentRunRepository.existsByWorkspaceIdAndProjectIdAndStatusIn(workspaceId, projectId, ACTIVE_STATUSES);
    }
}
