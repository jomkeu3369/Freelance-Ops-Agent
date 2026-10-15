package com.freelanceops.backend.domain.quotation.service;

import com.freelanceops.backend.domain.project.entity.ProjectEntity;
import com.freelanceops.backend.domain.project.repository.ProjectRepository;
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

    public QuotationAssumptionService(
            WorkspacePermissionReader permissionReader, ProjectRepository projectRepository) {
        this.permissionReader = permissionReader;
        this.projectRepository = projectRepository;
    }

    public QuotationAssumptionSuggestionResponse suggest(
            UUID userId,
            UUID workspaceId,
            UUID projectId,
            SuggestQuotationAssumptionRequest request,
            String traceparent) {
        MembershipPermissions membership =
                permissionReader
                        .findActiveMembership(userId, workspaceId)
                        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        requirePermission(membership, PermissionCode.PROJECT_READ);
        requirePermission(membership, PermissionCode.QUOTATION_WRITE);
        requirePermission(membership, PermissionCode.AGENT_RUN);
        ProjectEntity project =
                projectRepository
                        .findByIdAndWorkspaceId(projectId, workspaceId)
                        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));

        project.requireNotDeleting();
        // 이 동기식 경로에는 예약과 종료 확인 절차가 없다. 주간·금액 한도를 우회하지 않도록 토큰 발급과 모델 호출 전에 중단한다.
        throw new QuotationAssumptionUnavailableException();
    }

    private static void requirePermission(
            MembershipPermissions membership, PermissionCode permission) {
        if (!membership.permissions().contains(permission)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        }
    }
}
