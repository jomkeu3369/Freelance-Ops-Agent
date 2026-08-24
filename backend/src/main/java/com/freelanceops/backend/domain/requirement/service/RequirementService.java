package com.freelanceops.backend.domain.requirement.service;

import com.freelanceops.backend.domain.project.repository.ProjectRepository;
import com.freelanceops.backend.domain.requirement.dto.request.CreateRequirementVersionRequest;
import com.freelanceops.backend.domain.requirement.dto.response.RequirementFeatureResponse;
import com.freelanceops.backend.domain.requirement.dto.response.RequirementQuestionResponse;
import com.freelanceops.backend.domain.requirement.dto.response.RequirementVersionResponse;
import com.freelanceops.backend.domain.requirement.entity.RequirementAssumptionEntity;
import com.freelanceops.backend.domain.requirement.entity.RequirementFeatureEntity;
import com.freelanceops.backend.domain.requirement.entity.RequirementQuestionEntity;
import com.freelanceops.backend.domain.requirement.entity.RequirementVersionEntity;
import com.freelanceops.backend.domain.requirement.model.RequirementPriority;
import com.freelanceops.backend.domain.requirement.repository.RequirementAssumptionRepository;
import com.freelanceops.backend.domain.requirement.repository.RequirementFeatureRepository;
import com.freelanceops.backend.domain.requirement.repository.RequirementQuestionRepository;
import com.freelanceops.backend.domain.requirement.repository.RequirementVersionRepository;
import com.freelanceops.backend.domain.workspace.policy.AuthorizationDecision;
import com.freelanceops.backend.domain.workspace.policy.PermissionCode;
import com.freelanceops.backend.domain.workspace.service.WorkspaceAuthorizationService;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Service
public class RequirementService {

    private final ProjectRepository projectRepository;
    private final RequirementVersionRepository versionRepository;
    private final RequirementFeatureRepository featureRepository;
    private final RequirementAssumptionRepository assumptionRepository;
    private final RequirementQuestionRepository questionRepository;
    private final WorkspaceAuthorizationService authorizationService;

    public RequirementService(ProjectRepository projectRepository, RequirementVersionRepository versionRepository, RequirementFeatureRepository featureRepository, RequirementAssumptionRepository assumptionRepository, RequirementQuestionRepository questionRepository, WorkspaceAuthorizationService authorizationService) {
        this.projectRepository = projectRepository;
        this.versionRepository = versionRepository;
        this.featureRepository = featureRepository;
        this.assumptionRepository = assumptionRepository;
        this.questionRepository = questionRepository;
        this.authorizationService = authorizationService;
    }

    @Transactional(readOnly = true)
    public List<RequirementVersionResponse> list(UUID userId, UUID workspaceId, UUID projectId) {
        authorize(userId, workspaceId, PermissionCode.PROJECT_READ);
        requireProject(workspaceId, projectId);
        return versionRepository.findAllByWorkspaceIdAndProjectIdOrderByVersionNumberDesc(workspaceId, projectId)
            .stream().map(this::response).toList();
    }

    @Transactional(readOnly = true)
    public RequirementVersionResponse get(UUID userId, UUID workspaceId, UUID projectId, UUID requirementVersionId) {
        authorize(userId, workspaceId, PermissionCode.PROJECT_READ);
        return response(versionRepository.findByIdAndWorkspaceIdAndProjectId(requirementVersionId, workspaceId, projectId)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND)));
    }

    @Transactional
    public RequirementVersionResponse create(UUID userId, UUID workspaceId, UUID projectId, CreateRequirementVersionRequest request) {
        authorize(userId, workspaceId, PermissionCode.PROJECT_WRITE);
        projectRepository.findByIdAndWorkspaceIdForUpdate(projectId, workspaceId)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND))
            .requireNotDeleting();
        int versionNumber = versionRepository.findTopByWorkspaceIdAndProjectIdOrderByVersionNumberDesc(workspaceId, projectId)
            .map(current -> current.versionNumber() + 1).orElse(1);
        Instant now = Instant.now();
        UUID versionId = UUID.randomUUID();
        RequirementVersionEntity requirement = versionRepository.saveAndFlush(new RequirementVersionEntity(
            versionId, workspaceId, projectId, versionNumber, request.sourceText().trim(), userId, now
        ));
        List<RequirementFeatureEntity> features = new ArrayList<>();
        for (int index = 0; index < request.features().size(); index++) {
            var feature = request.features().get(index);
            features.add(new RequirementFeatureEntity(UUID.randomUUID(), workspaceId, versionId, feature.title().trim(), feature.description().trim(), feature.priority().name(), trim(feature.acceptanceCriteria()), index, now));
        }
        List<RequirementAssumptionEntity> assumptions = new ArrayList<>();
        for (int index = 0; index < request.assumptions().size(); index++) {
            assumptions.add(new RequirementAssumptionEntity(UUID.randomUUID(), workspaceId, versionId, request.assumptions().get(index).trim(), index, now));
        }
        List<RequirementQuestionEntity> questions = new ArrayList<>();
        for (int index = 0; index < request.questions().size(); index++) {
            questions.add(new RequirementQuestionEntity(UUID.randomUUID(), workspaceId, versionId, request.questions().get(index).trim(), index, now));
        }
        featureRepository.saveAll(features);
        assumptionRepository.saveAll(assumptions);
        questionRepository.saveAll(questions);
        return response(requirement, features, assumptions, questions);
    }

    private void requireProject(UUID workspaceId, UUID projectId) {
        if (projectRepository.findByIdAndWorkspaceId(projectId, workspaceId).isEmpty()) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        }
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

    private RequirementVersionResponse response(RequirementVersionEntity version) {
        return response(
            version,
            featureRepository.findAllByWorkspaceIdAndRequirementVersionIdOrderBySortOrder(version.workspaceId(), version.id()),
            assumptionRepository.findAllByWorkspaceIdAndRequirementVersionIdOrderBySortOrder(version.workspaceId(), version.id()),
            questionRepository.findAllByWorkspaceIdAndRequirementVersionIdOrderBySortOrder(version.workspaceId(), version.id())
        );
    }

    private RequirementVersionResponse response(RequirementVersionEntity version, List<RequirementFeatureEntity> features, List<RequirementAssumptionEntity> assumptions, List<RequirementQuestionEntity> questions) {
        return new RequirementVersionResponse(
            version.id(), version.workspaceId(), version.projectId(), version.versionNumber(), version.sourceText(),
            features.stream().map(feature -> new RequirementFeatureResponse(feature.title(), feature.description(), RequirementPriority.valueOf(feature.priority()), feature.acceptanceCriteria())).toList(),
            assumptions.stream().map(RequirementAssumptionEntity::content).toList(),
            questions.stream().map(question -> new RequirementQuestionResponse(question.content(), question.status())).toList(),
            version.createdBy(), version.createdAt()
        );
    }

    private static String trim(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }
}
