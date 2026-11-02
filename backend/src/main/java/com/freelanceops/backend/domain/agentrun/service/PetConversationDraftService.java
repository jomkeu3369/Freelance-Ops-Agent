package com.freelanceops.backend.domain.agentrun.service;

import com.freelanceops.backend.domain.agentrun.dto.request.AcceptProjectPetDraftRequest;
import com.freelanceops.backend.domain.agentrun.dto.response.ProjectPetConversationResponse;
import com.freelanceops.backend.domain.agentrun.repository.AgentRunRepository;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.util.UUID;

@Service
public class PetConversationDraftService {
    private final ProjectPetConversationService conversations;
    private final AgentRunGatewayService gateway;
    private final AgentRunRepository runs;

    public PetConversationDraftService(ProjectPetConversationService conversations,
            AgentRunGatewayService gateway, AgentRunRepository runs) {
        this.conversations = conversations;
        this.gateway = gateway;
        this.runs = runs;
    }

    public ProjectPetConversationResponse accept(UUID user, UUID workspace, UUID project,
            AcceptProjectPetDraftRequest input) {
        conversations.get(user, workspace, project);
        var run = runs.findByIdAndWorkspaceId(input.runId(), workspace)
                .filter(value -> value.projectId().equals(project) && value.initiatedBy().equals(user))
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        var view = gateway.get(user, workspace, input.runId(), null);
        return conversations.accept(user, workspace, project, input, run, view);
    }
}
