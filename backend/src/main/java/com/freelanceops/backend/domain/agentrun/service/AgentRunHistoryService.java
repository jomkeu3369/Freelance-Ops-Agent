package com.freelanceops.backend.domain.agentrun.service;

import com.freelanceops.backend.domain.agentrun.client.dto.request.InternalAgentRunRequest;
import com.freelanceops.backend.domain.agentrun.dto.response.AgentChatTurn;
import com.freelanceops.backend.domain.agentrun.model.AgentRunCommandType;
import com.freelanceops.backend.domain.agentrun.repository.AgentRunCommandRepository;
import com.freelanceops.backend.domain.agentrun.repository.AgentRunRepository;
import com.freelanceops.backend.domain.project.repository.ProjectRepository;
import com.freelanceops.backend.domain.workspace.policy.PermissionCode;
import com.freelanceops.backend.domain.workspace.repository.WorkspacePermissionReader;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.ObjectMapper;

import java.util.List;
import java.util.UUID;

@Service
public class AgentRunHistoryService {
    private final WorkspacePermissionReader permissions;
    private final ProjectRepository projects;
    private final AgentRunRepository runs;
    private final AgentRunCommandRepository commands;
    private final ObjectMapper mapper;

    public AgentRunHistoryService(WorkspacePermissionReader permissions, ProjectRepository projects,
                                  AgentRunRepository runs, AgentRunCommandRepository commands, ObjectMapper mapper) {
        this.permissions = permissions;
        this.projects = projects;
        this.runs = runs;
        this.commands = commands;
        this.mapper = mapper;
    }

    @Transactional(readOnly = true)
    public List<AgentChatTurn> list(UUID userId, UUID workspaceId, UUID projectId, int limit) {
        if (limit < 1 || limit > 50) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "limit must be 1 to 50");
        var membership = permissions.findActiveMembership(userId, workspaceId)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        if (!membership.permissions().contains(PermissionCode.AGENT_RUN)
            || !membership.permissions().contains(PermissionCode.PROJECT_READ)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        }
        if (projects.findByIdAndWorkspaceId(projectId, workspaceId).isEmpty()) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        }
        return runs.findByWorkspaceIdAndProjectIdOrderByCreatedAtDesc(workspaceId, projectId, PageRequest.of(0, limit))
            .stream().map(run -> {
                var command = commands.findFirstByRunIdAndCommandTypeOrderByCreatedAtAsc(run.id(), AgentRunCommandType.START)
                    .orElseThrow(() -> new IllegalStateException("Agent run is missing its original input"));
                try {
                    var request = mapper.readValue(command.payload(), InternalAgentRunRequest.class);
                    if (request.input() == null || request.input().requirementText() == null) {
                        throw new IllegalStateException("Agent run input is missing");
                    }
                    return new AgentChatTurn(run.id(), request.input().requirementText(), run.status(), run.createdAt());
                } catch (JacksonException error) {
                    throw new IllegalStateException("Agent run input cannot be decoded", error);
                }
            }).toList();
    }
}
