package com.freelanceops.backend.domain.knowledge.service;

import com.freelanceops.backend.domain.agentrun.service.ProviderPolicy;
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
    public RaptorIndexService(WorkspacePermissionReader permissionReader, ProjectRepository projectRepository) {
        this.permissionReader = permissionReader; this.projectRepository = projectRepository;
    }

    public RaptorIndexResponse rebuild(UUID userId, UUID workspaceId, UUID projectId, CreateRaptorIndexRequest request, String traceparent) {
        MembershipPermissions membership = permissionReader.findActiveMembership(userId, workspaceId).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        require(membership, PermissionCode.DOCUMENT_WRITE); require(membership, PermissionCode.AGENT_RUN);
        projectRepository.findByIdAndWorkspaceId(projectId, workspaceId).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));

        ProviderPolicy.requireSupported(request.provider());
        // This endpoint predates platform/BYOK reservations and settlement. A role
        // permission or enabled spend flag is not a bounded payment authorization.
        throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
            "RAPTOR_COST_CONTROL_UNSUPPORTED: 벡터 색인의 비용 통제가 아직 지원되지 않습니다. 확인한 문서는 키워드 검색으로 사용할 수 있습니다.");
    }

    private static void require(MembershipPermissions membership, PermissionCode permission) {
        if (!membership.permissions().contains(permission)) throw new ResponseStatusException(HttpStatus.FORBIDDEN);
    }
}
