package com.freelanceops.backend.domain.internaltool.service;
import com.freelanceops.backend.domain.agentrun.service.AIConnectionService;

import com.freelanceops.backend.domain.agentrun.model.Provider;
import com.freelanceops.backend.domain.agentrun.repository.AgentRunRepository;
import com.freelanceops.backend.domain.internaltool.security.DelegationPrincipal;
import com.freelanceops.backend.domain.project.repository.ProjectRepository;
import com.freelanceops.backend.domain.workspace.policy.*;
import com.freelanceops.backend.domain.workspace.service.WorkspaceAuthorizationService;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import java.util.UUID;

@org.springframework.stereotype.Service

public class InternalCredentialService {
    private final AIConnectionService service;
    private final WorkspaceAuthorizationService authorization;
    private final ProjectRepository projects;
    private final AgentRunRepository runs;
    public InternalCredentialService(AIConnectionService service, WorkspaceAuthorizationService authorization, ProjectRepository projects, AgentRunRepository runs) {
        this.service = service; this.authorization = authorization; this.projects = projects; this.runs = runs;
    }

    public record Credential(String apiKey) {
        @Override public String toString() { return "Credential[redacted]"; }
    }

    public Credential resolve(UUID id, Provider provider, String model,
        DelegationPrincipal principal) {
        if (!principal.permissions().contains("agent.run") || !principal.permissions().contains("project.read") ||
            authorization.authorize(principal.initiatedBy(), principal.workspaceId(), PermissionCode.PROJECT_READ) != AuthorizationDecision.ALLOWED) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        }
        projects.findByIdAndWorkspaceId(principal.projectId(), principal.workspaceId())
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND)).requireNotDeleting();
        runs.findById(principal.runId()).ifPresent(run -> {
            if (!principal.workspaceId().equals(run.workspaceId()) || !principal.projectId().equals(run.projectId()) ||
                !principal.initiatedBy().equals(run.initiatedBy()) || !id.equals(run.credentialId()) || provider != run.provider() || !model.equals(run.model())) {
                throw new ResponseStatusException(HttpStatus.FORBIDDEN);
            }
        });
        return new Credential(service.resolve(principal.initiatedBy(), principal.workspaceId(), id, provider, model));
    }
}
