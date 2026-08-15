package com.freelanceops.backend.domain.quotation.service;

import com.freelanceops.backend.domain.agentrun.client.dto.request.InternalAgentRunRequest.TrustedRunContext;
import com.freelanceops.backend.domain.agentrun.security.DelegationTokenIssuer;
import com.freelanceops.backend.domain.project.entity.ProjectEntity;
import com.freelanceops.backend.domain.project.repository.ProjectRepository;
import com.freelanceops.backend.domain.quotation.client.QuotationAssumptionClient;
import com.freelanceops.backend.domain.quotation.client.dto.request.InternalAssumptionSuggestionRequest;
import com.freelanceops.backend.domain.quotation.client.dto.response.InternalAssumptionSuggestionResponse;
import com.freelanceops.backend.domain.quotation.dto.request.SuggestQuotationAssumptionRequest;
import com.freelanceops.backend.domain.quotation.dto.response.QuotationAssumptionSuggestionResponse;
import com.freelanceops.backend.domain.workspace.policy.MembershipPermissions;
import com.freelanceops.backend.domain.workspace.policy.PermissionCode;
import com.freelanceops.backend.domain.workspace.repository.WorkspacePermissionReader;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.util.Comparator;
import java.util.List;
import java.util.UUID;

@Service
public class QuotationAssumptionService {
    private final WorkspacePermissionReader permissionReader;
    private final ProjectRepository projectRepository;
    private final DelegationTokenIssuer tokenIssuer;
    private final QuotationAssumptionClient client;

    public QuotationAssumptionService(WorkspacePermissionReader permissionReader, ProjectRepository projectRepository, DelegationTokenIssuer tokenIssuer, QuotationAssumptionClient client) {
        this.permissionReader = permissionReader;
        this.projectRepository = projectRepository;
        this.tokenIssuer = tokenIssuer;
        this.client = client;
    }

    public QuotationAssumptionSuggestionResponse suggest(UUID userId, UUID workspaceId, UUID projectId, SuggestQuotationAssumptionRequest request, String traceparent) {
        MembershipPermissions membership = permissionReader.findActiveMembership(userId, workspaceId)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        requirePermission(membership, PermissionCode.PROJECT_READ);
        requirePermission(membership, PermissionCode.QUOTATION_WRITE);
        requirePermission(membership, PermissionCode.AGENT_RUN);
        ProjectEntity project = projectRepository.findByIdAndWorkspaceId(projectId, workspaceId)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));

        UUID requestId = UUID.randomUUID();
        List<String> permissions = membership.permissions().stream()
            .map(PermissionCode::code)
            .sorted(Comparator.naturalOrder())
            .toList();
        String token = tokenIssuer.issue(requestId, workspaceId, projectId, userId, permissions);
        InternalAssumptionSuggestionResponse response = client.suggest(
            new InternalAssumptionSuggestionRequest(
                new TrustedRunContext(requestId, UUID.randomUUID(), traceparent, workspaceId, projectId, userId, permissions),
                request.modelSelection(),
                project.requirementText(),
                request.itemTitle().trim(),
                request.itemDescription() == null ? "" : request.itemDescription().trim(),
                request.quantity(),
                request.unit().name(),
                request.currentAssumption() == null ? "" : request.currentAssumption().trim()
            ),
            token,
            traceparent
        );
        if (response == null || !requestId.equals(response.runId())) {
            throw new IllegalStateException("assumption response id does not match the issued request id");
        }
        if (response.provider() != request.modelSelection().provider() || !response.model().equals(request.modelSelection().model())) {
            throw new IllegalStateException("assumption response model does not match the selected model");
        }
        return new QuotationAssumptionSuggestionResponse(requestId, response.content(), response.provider(), response.model());
    }

    private static void requirePermission(MembershipPermissions membership, PermissionCode permission) {
        if (!membership.permissions().contains(permission)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        }
    }
}
