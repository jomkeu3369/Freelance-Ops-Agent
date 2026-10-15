package com.freelanceops.backend.domain.quotation.service;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.freelanceops.backend.domain.project.entity.ProjectEntity;
import com.freelanceops.backend.domain.project.repository.ProjectRepository;
import com.freelanceops.backend.domain.quotation.controller.QuotationAssumptionExceptionHandler;
import com.freelanceops.backend.domain.workspace.policy.MembershipPermissions;
import com.freelanceops.backend.domain.workspace.policy.PermissionCode;
import com.freelanceops.backend.domain.workspace.repository.WorkspacePermissionReader;

import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

import java.util.Optional;
import java.util.Set;
import java.util.UUID;

class QuotationAssumptionBudgetTest {
    @Test
    void unavailableEndpointReturnsStableBudgetError() {
        var handler = new QuotationAssumptionExceptionHandler();
        var result = handler.unavailable(new QuotationAssumptionUnavailableException());
        assertThat(result.getStatusCode().value()).isEqualTo(409);
        assertThat(result.getBody().code()).isEqualTo("ASSUMPTION_BUDGET_UNAVAILABLE");
    }

    @Test
    void standaloneSuggestionCannotBypassCreditAndMoneyAdmission() {
        var permissions = mock(WorkspacePermissionReader.class);
        var projects = mock(ProjectRepository.class);
        UUID user = UUID.randomUUID(), workspace = UUID.randomUUID(), project = UUID.randomUUID();
        when(permissions.findActiveMembership(user, workspace))
                .thenReturn(
                        Optional.of(
                                new MembershipPermissions(
                                        UUID.randomUUID(),
                                        Set.of(
                                                PermissionCode.PROJECT_READ,
                                                PermissionCode.QUOTATION_WRITE,
                                                PermissionCode.AGENT_RUN))));
        var projectEntity = mock(ProjectEntity.class);
        when(projects.findByIdAndWorkspaceId(project, workspace))
                .thenReturn(Optional.of(projectEntity));
        var service = new QuotationAssumptionService(permissions, projects);
        assertThatThrownBy(() -> service.suggest(user, workspace, project, null, "trace"))
                .isInstanceOfSatisfying(
                        ResponseStatusException.class,
                        error -> assertThat(error.getStatusCode().value()).isEqualTo(409));
        verify(projectEntity).requireNotDeleting();
    }

    @Test
    void missingMembershipRemainsNotFoundBeforeCheckingProject() {
        var permissions = mock(WorkspacePermissionReader.class);
        var projects = mock(ProjectRepository.class);
        UUID userId = UUID.randomUUID();
        UUID workspaceId = UUID.randomUUID();
        when(permissions.findActiveMembership(userId, workspaceId)).thenReturn(Optional.empty());
        var service = new QuotationAssumptionService(permissions, projects);

        assertThatThrownBy(
                        () -> service.suggest(userId, workspaceId, UUID.randomUUID(), null, null))
                .isInstanceOfSatisfying(
                        ResponseStatusException.class,
                        error -> assertThat(error.getStatusCode().value()).isEqualTo(404));
        verifyNoInteractions(projects);
    }

    @Test
    void missingQuotationPermissionRemainsForbidden() {
        var permissions = mock(WorkspacePermissionReader.class);
        var projects = mock(ProjectRepository.class);
        UUID userId = UUID.randomUUID();
        UUID workspaceId = UUID.randomUUID();
        when(permissions.findActiveMembership(userId, workspaceId))
                .thenReturn(
                        Optional.of(
                                new MembershipPermissions(
                                        UUID.randomUUID(),
                                        Set.of(
                                                PermissionCode.PROJECT_READ,
                                                PermissionCode.AGENT_RUN))));
        var service = new QuotationAssumptionService(permissions, projects);

        assertThatThrownBy(
                        () -> service.suggest(userId, workspaceId, UUID.randomUUID(), null, null))
                .isInstanceOfSatisfying(
                        ResponseStatusException.class,
                        error -> assertThat(error.getStatusCode().value()).isEqualTo(403));
        verifyNoInteractions(projects);
    }
}
