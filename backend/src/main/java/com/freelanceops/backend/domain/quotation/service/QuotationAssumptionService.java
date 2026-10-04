package com.freelanceops.backend.domain.quotation.service;

import com.freelanceops.backend.domain.agentrun.security.DelegationTokenIssuer;
import com.freelanceops.backend.domain.project.entity.ProjectEntity;
import com.freelanceops.backend.domain.project.repository.ProjectRepository;
import com.freelanceops.backend.domain.quotation.client.QuotationAssumptionClient;
import com.freelanceops.backend.domain.quotation.dto.request.SuggestQuotationAssumptionRequest;
import com.freelanceops.backend.domain.quotation.dto.response.QuotationAssumptionSuggestionResponse;
import com.freelanceops.backend.domain.workspace.policy.MembershipPermissions;
import com.freelanceops.backend.domain.workspace.policy.PermissionCode;
import com.freelanceops.backend.domain.workspace.repository.WorkspacePermissionReader;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.util.UUID;

@Service
public class QuotationAssumptionService {
    private final WorkspacePermissionReader permissionReader;
    private final ProjectRepository projectRepository;
    private final DelegationTokenIssuer tokenIssuer;
    private final QuotationAssumptionClient client;
    private final com.freelanceops.backend.domain.agentrun.service.AIConnectionService connections;

    public QuotationAssumptionService(WorkspacePermissionReader permissionReader, ProjectRepository projectRepository, DelegationTokenIssuer tokenIssuer, QuotationAssumptionClient client, com.freelanceops.backend.domain.agentrun.service.AIConnectionService connections) {
        this.permissionReader = permissionReader;
        this.projectRepository = projectRepository;
        this.tokenIssuer = tokenIssuer;
        this.client = client;
        this.connections = connections;
    }

    public QuotationAssumptionSuggestionResponse suggest(UUID userId, UUID workspaceId, UUID projectId, SuggestQuotationAssumptionRequest request, String traceparent) {
        MembershipPermissions membership = permissionReader.findActiveMembership(userId, workspaceId)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        requirePermission(membership, PermissionCode.PROJECT_READ);
        requirePermission(membership, PermissionCode.QUOTATION_WRITE);
        requirePermission(membership, PermissionCode.AGENT_RUN);
        ProjectEntity project = projectRepository.findByIdAndWorkspaceId(projectId, workspaceId)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));

        project.requireNotDeleting();
        // This synchronous side endpoint has no durable admission + terminal outcome protocol.
        // Fail before issuing a token/provider call instead of bypassing weekly and monetary limits.
        throw new QuotationAssumptionUnavailableException();
    }

    private static void requirePermission(MembershipPermissions membership, PermissionCode permission) {
        if (!membership.permissions().contains(permission)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        }
    }
}
