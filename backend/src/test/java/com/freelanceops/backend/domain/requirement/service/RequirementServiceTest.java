package com.freelanceops.backend.domain.requirement.service;

import com.freelanceops.backend.domain.project.entity.ProjectEntity;
import com.freelanceops.backend.domain.project.repository.ProjectRepository;
import com.freelanceops.backend.domain.requirement.dto.request.CreateRequirementVersionRequest;
import com.freelanceops.backend.domain.requirement.dto.request.RequirementFeatureRequest;
import com.freelanceops.backend.domain.requirement.entity.RequirementVersionEntity;
import com.freelanceops.backend.domain.requirement.model.RequirementPriority;
import com.freelanceops.backend.domain.requirement.repository.RequirementAssumptionRepository;
import com.freelanceops.backend.domain.requirement.repository.RequirementFeatureRepository;
import com.freelanceops.backend.domain.requirement.repository.RequirementQuestionRepository;
import com.freelanceops.backend.domain.requirement.repository.RequirementVersionRepository;
import com.freelanceops.backend.domain.workspace.policy.AuthorizationDecision;
import com.freelanceops.backend.domain.workspace.policy.PermissionCode;
import com.freelanceops.backend.domain.workspace.service.WorkspaceAuthorizationService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class RequirementServiceTest {
    @Mock private ProjectRepository projectRepository;
    @Mock private RequirementVersionRepository versionRepository;
    @Mock private RequirementFeatureRepository featureRepository;
    @Mock private RequirementAssumptionRepository assumptionRepository;
    @Mock private RequirementQuestionRepository questionRepository;
    @Mock private WorkspaceAuthorizationService authorizationService;

    @Test
    void createLocksProjectAndAppendsImmutableVersion() {
        UUID userId = UUID.randomUUID();
        UUID workspaceId = UUID.randomUUID();
        UUID projectId = UUID.randomUUID();
        when(authorizationService.authorize(userId, workspaceId, PermissionCode.PROJECT_WRITE)).thenReturn(AuthorizationDecision.ALLOWED);
        when(projectRepository.findByIdAndWorkspaceIdForUpdate(projectId, workspaceId)).thenReturn(Optional.of(project(projectId, workspaceId)));
        when(versionRepository.findTopByWorkspaceIdAndProjectIdOrderByVersionNumberDesc(workspaceId, projectId))
            .thenReturn(Optional.of(new RequirementVersionEntity(UUID.randomUUID(), workspaceId, projectId, 2, "old", userId, Instant.now())));
        when(versionRepository.saveAndFlush(any())).thenAnswer(invocation -> invocation.getArgument(0));
        RequirementService service = service();

        var response = service.create(userId, workspaceId, projectId, new CreateRequirementVersionRequest(
            "원문 요구사항",
            List.of(new RequirementFeatureRequest("로그인", "이메일 로그인", RequirementPriority.MUST, "정상 로그인")),
            List.of("이메일 계정을 사용한다"),
            List.of("소셜 로그인도 필요한가?")
        ));

        assertThat(response.versionNumber()).isEqualTo(3);
        assertThat(response.features()).hasSize(1);
        assertThat(response.assumptions()).containsExactly("이메일 계정을 사용한다");
        verify(featureRepository).saveAll(any());
        verify(assumptionRepository).saveAll(any());
        verify(questionRepository).saveAll(any());
    }

    @Test
    void forbiddenCreateDoesNotRevealOrLockProject() {
        UUID userId = UUID.randomUUID();
        UUID workspaceId = UUID.randomUUID();
        when(authorizationService.authorize(userId, workspaceId, PermissionCode.PROJECT_WRITE)).thenReturn(AuthorizationDecision.FORBIDDEN);

        assertThatThrownBy(() -> service().create(userId, workspaceId, UUID.randomUUID(), new CreateRequirementVersionRequest("요구사항", List.of(), List.of(), List.of())))
            .isInstanceOfSatisfying(ResponseStatusException.class, error -> assertThat(error.getStatusCode().value()).isEqualTo(403));
        verify(projectRepository, never()).findByIdAndWorkspaceIdForUpdate(any(), any());
    }

    private RequirementService service() {
        return new RequirementService(projectRepository, versionRepository, featureRepository, assumptionRepository, questionRepository, authorizationService);
    }

    private static ProjectEntity project(UUID projectId, UUID workspaceId) {
        return new ProjectEntity(projectId, workspaceId, "Project", "Requirement", "KRW", null, null, null);
    }
}
