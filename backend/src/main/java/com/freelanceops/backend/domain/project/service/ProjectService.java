package com.freelanceops.backend.domain.project.service;

import com.freelanceops.backend.domain.agentrun.model.AgentRunStatus;
import com.freelanceops.backend.domain.agentrun.repository.AgentRunRepository;
import com.freelanceops.backend.domain.client.repository.ClientRepository;
import com.freelanceops.backend.domain.project.dto.request.CreateProjectRequest;
import com.freelanceops.backend.domain.project.dto.request.UpdateProjectRequest;
import com.freelanceops.backend.domain.project.dto.response.ProjectResponse;
import com.freelanceops.backend.domain.project.entity.ProjectEntity;
import com.freelanceops.backend.domain.project.entity.ProjectStatus;
import com.freelanceops.backend.domain.project.repository.ProjectRepository;
import com.freelanceops.backend.domain.workspace.service.WorkspaceAuthorizationService;
import com.freelanceops.backend.domain.workspace.policy.AuthorizationDecision;
import com.freelanceops.backend.domain.workspace.policy.PermissionCode;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.util.EnumSet;
import java.util.List;
import java.util.UUID;

@Service
public class ProjectService {

    private static final EnumSet<AgentRunStatus> ACTIVE_AGENT_STATUSES = EnumSet.of(
        AgentRunStatus.QUEUED,
        AgentRunStatus.RUNNING,
        AgentRunStatus.WAITING_FOR_USER
    );

    private final ProjectRepository projectRepository;
    private final ClientRepository clientRepository;
    private final AgentRunRepository agentRunRepository;
    private final WorkspaceAuthorizationService authorizationService;

    public ProjectService(ProjectRepository projectRepository, ClientRepository clientRepository, AgentRunRepository agentRunRepository, WorkspaceAuthorizationService authorizationService) {
        this.projectRepository = projectRepository;
        this.clientRepository = clientRepository;
        this.agentRunRepository = agentRunRepository;
        this.authorizationService = authorizationService;
    }

    @Transactional(readOnly = true)
    public List<ProjectResponse> list(UUID userId, UUID workspaceId) {
        authorize(userId, workspaceId, PermissionCode.PROJECT_READ);
        return projectRepository.findAllByWorkspaceIdOrderByUpdatedAtDesc(workspaceId).stream()
            .map(ProjectService::response)
            .toList();
    }

    @Transactional(readOnly = true)
    public ProjectResponse get(UUID userId, UUID workspaceId, UUID projectId) {
        authorize(userId, workspaceId, PermissionCode.PROJECT_READ);
        return response(find(workspaceId, projectId));
    }

    @Transactional
    public ProjectResponse create(UUID userId, UUID workspaceId, CreateProjectRequest request) {
        authorize(userId, workspaceId, PermissionCode.PROJECT_WRITE);
        validateBudget(request.budgetMin(), request.budgetMax());
        validateClient(workspaceId, request.clientId());
        ProjectEntity project = new ProjectEntity(
            UUID.randomUUID(),
            workspaceId,
            request.clientId(),
            request.title(),
            request.requirementText(),
            request.currency(),
            request.deadline(),
            request.budgetMin(),
            request.budgetMax(),
            ProjectStatus.LEAD.name(),
            userId,
            Instant.now()
        );
        return response(projectRepository.save(project));
    }

    @Transactional
    public ProjectResponse update(UUID userId, UUID workspaceId, UUID projectId, UpdateProjectRequest request) {
        authorize(userId, workspaceId, PermissionCode.PROJECT_WRITE);
        validateBudget(request.budgetMin(), request.budgetMax());
        validateClient(workspaceId, request.clientId());
        ProjectEntity project = find(workspaceId, projectId);
        project.update(
            request.clientId(),
            request.title(),
            request.requirementText(),
            request.currency(),
            request.deadline(),
            request.budgetMin(),
            request.budgetMax(),
            request.status().name(),
            Instant.now()
        );
        return response(projectRepository.save(project));
    }

    @Transactional
    public void delete(UUID userId, UUID workspaceId, UUID projectId) {
        authorize(userId, workspaceId, PermissionCode.PROJECT_DELETE);
        ProjectEntity project = find(workspaceId, projectId);
        if (agentRunRepository.existsByWorkspaceIdAndProjectIdAndStatusIn(workspaceId, projectId, ACTIVE_AGENT_STATUSES)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "진행 중인 AI 분석을 중단한 뒤 프로젝트를 삭제하세요.");
        }
        projectRepository.delete(project);
    }

    private ProjectEntity find(UUID workspaceId, UUID projectId) {
        return projectRepository.findByIdAndWorkspaceId(projectId, workspaceId)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
    }

    private void authorize(UUID userId, UUID workspaceId, PermissionCode permission) {
        AuthorizationDecision decision = authorizationService.authorize(userId, workspaceId, permission);
        if (decision == AuthorizationDecision.NOT_FOUND) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        }
        if (decision == AuthorizationDecision.FORBIDDEN) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        }
    }

    private void validateClient(UUID workspaceId, UUID clientId) {
        if (clientId != null && clientRepository.findByIdAndWorkspaceId(clientId, workspaceId).isEmpty()) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        }
    }

    private static void validateBudget(java.math.BigDecimal minimum, java.math.BigDecimal maximum) {
        if (minimum != null && maximum != null && minimum.compareTo(maximum) > 0) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "budgetMin must not exceed budgetMax");
        }
    }

    private static ProjectResponse response(ProjectEntity project) {
        return new ProjectResponse(
            project.id(),
            project.workspaceId(),
            project.clientId(),
            project.title(),
            project.requirementText(),
            project.currency(),
            project.deadline(),
            project.budgetMin(),
            project.budgetMax(),
            ProjectStatus.valueOf(project.status()),
            project.createdBy(),
            project.createdAt(),
            project.updatedAt(),
            project.version()
        );
    }
}


