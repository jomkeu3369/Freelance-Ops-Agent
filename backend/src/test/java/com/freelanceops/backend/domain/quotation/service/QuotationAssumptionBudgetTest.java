package com.freelanceops.backend.domain.quotation.service;

import com.freelanceops.backend.domain.agentrun.security.DelegationTokenIssuer;
import com.freelanceops.backend.domain.agentrun.service.AIConnectionService;
import com.freelanceops.backend.domain.project.entity.ProjectEntity;
import com.freelanceops.backend.domain.project.repository.ProjectRepository;
import com.freelanceops.backend.domain.quotation.client.QuotationAssumptionClient;
import com.freelanceops.backend.domain.workspace.policy.MembershipPermissions;
import com.freelanceops.backend.domain.workspace.policy.PermissionCode;
import com.freelanceops.backend.domain.workspace.repository.WorkspacePermissionReader;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

class QuotationAssumptionBudgetTest {
    @Test void unavailableEndpointReturnsStableBudgetError() {
        var handler = new com.freelanceops.backend.domain.quotation.controller.QuotationAssumptionExceptionHandler();
        var result = handler.unavailable(new QuotationAssumptionUnavailableException());
        assertThat(result.getStatusCode().value()).isEqualTo(409);
        assertThat(result.getBody().code()).isEqualTo("ASSUMPTION_BUDGET_UNAVAILABLE");
    }

    @Test void standaloneSuggestionCannotBypassCreditAndMoneyAdmission() {
        var permissions = mock(WorkspacePermissionReader.class);
        var projects = mock(ProjectRepository.class);
        var tokens = mock(DelegationTokenIssuer.class);
        var client = mock(QuotationAssumptionClient.class);
        var connections = mock(AIConnectionService.class);
        UUID user = UUID.randomUUID(), workspace = UUID.randomUUID(), project = UUID.randomUUID();
        when(permissions.findActiveMembership(user, workspace)).thenReturn(Optional.of(new MembershipPermissions(
            UUID.randomUUID(), Set.of(PermissionCode.PROJECT_READ, PermissionCode.QUOTATION_WRITE, PermissionCode.AGENT_RUN))));
        when(projects.findByIdAndWorkspaceId(project, workspace)).thenReturn(Optional.of(mock(ProjectEntity.class)));
        var service = new QuotationAssumptionService(permissions, projects, tokens, client, connections);
        assertThatThrownBy(() -> service.suggest(user, workspace, project, null, "trace"))
            .isInstanceOfSatisfying(ResponseStatusException.class, error -> assertThat(error.getStatusCode().value()).isEqualTo(409));
        verifyNoInteractions(tokens, client, connections);
    }
}
