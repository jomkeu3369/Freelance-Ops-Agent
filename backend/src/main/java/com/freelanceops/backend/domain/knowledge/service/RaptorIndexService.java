package com.freelanceops.backend.domain.knowledge.service;

import com.freelanceops.backend.domain.agentrun.security.DelegationTokenIssuer;
import com.freelanceops.backend.domain.knowledge.client.RaptorBuildClient;
import com.freelanceops.backend.domain.knowledge.client.dto.request.RaptorBuildRequest;
import com.freelanceops.backend.domain.knowledge.client.dto.response.RaptorBuildResponse;
import com.freelanceops.backend.domain.knowledge.dto.request.CreateRaptorIndexRequest;
import com.freelanceops.backend.domain.knowledge.dto.response.RaptorIndexResponse;
import com.freelanceops.backend.domain.project.repository.ProjectRepository;
import com.freelanceops.backend.domain.workspace.policy.*;
import com.freelanceops.backend.domain.workspace.repository.WorkspacePermissionReader;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import java.util.*;

@Service
public class RaptorIndexService {
    private final WorkspacePermissionReader permissionReader;
    private final ProjectRepository projectRepository;
    private final DelegationTokenIssuer tokenIssuer;
    private final RaptorBuildClient client;
    private final RaptorIndexTransactions transactions;

    public RaptorIndexService(WorkspacePermissionReader permissionReader, ProjectRepository projectRepository, DelegationTokenIssuer tokenIssuer, RaptorBuildClient client, RaptorIndexTransactions transactions) {
        this.permissionReader = permissionReader; this.projectRepository = projectRepository; this.tokenIssuer = tokenIssuer;
        this.client = client; this.transactions = transactions;
    }

    public RaptorIndexResponse rebuild(UUID userId, UUID workspaceId, UUID projectId, CreateRaptorIndexRequest request, String traceparent) {
        MembershipPermissions membership = permissionReader.findActiveMembership(userId, workspaceId).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        require(membership, PermissionCode.DOCUMENT_WRITE); require(membership, PermissionCode.AGENT_RUN);
        projectRepository.findByIdAndWorkspaceId(projectId, workspaceId).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));

        UUID runId = UUID.randomUUID(); UUID snapshotId = UUID.randomUUID();
        RaptorIndexTransactions.PreparedBuild prepared = transactions.begin(snapshotId, workspaceId, userId, request.embeddingModel().trim(), request.summaryModel().trim());
        try {
            List<String> permissions = membership.permissions().stream().map(PermissionCode::code).sorted().collect(java.util.stream.Collectors.toCollection(ArrayList::new));
            permissions.add("knowledge.index");
            String token = tokenIssuer.issue(runId, workspaceId, projectId, userId, permissions);
            RaptorBuildRequest body = new RaptorBuildRequest(
                new RaptorBuildRequest.RaptorBuildContext(runId, workspaceId, projectId, snapshotId), request.provider().name(),
                request.embeddingModel().trim(), request.summaryModel().trim(),
                prepared.chunks().stream().map(chunk -> new RaptorBuildRequest.RaptorSourceChunk(chunk.chunkId(), chunk.documentId(), chunk.text(), chunk.metadata())).toList(),
                new RaptorBuildRequest.RaptorBuildOptions(request.targetClusterSize(), request.maxSummaryLevels(), request.kmeansIterations())
            );
            RaptorBuildResponse response = client.build(body, token, traceparent);
            int nodeCount = transactions.publish(prepared, response);
            return new RaptorIndexResponse(snapshotId, "PUBLISHED", nodeCount);
        } catch (RuntimeException error) {
            try { transactions.fail(workspaceId, snapshotId, error.getClass().getSimpleName()); }
            catch (RuntimeException failureError) { error.addSuppressed(failureError); }
            throw error;
        }
    }

    private static void require(MembershipPermissions membership, PermissionCode permission) {
        if (!membership.permissions().contains(permission)) throw new ResponseStatusException(HttpStatus.FORBIDDEN);
    }
}
