package com.freelanceops.backend.internaltool.application;

import com.freelanceops.backend.internaltool.api.ToolContracts;
import com.freelanceops.backend.internaltool.security.DelegationPrincipal;
import com.freelanceops.backend.project.infrastructure.persistence.ProjectEntity;
import com.freelanceops.backend.project.infrastructure.persistence.ProjectRepository;
import com.freelanceops.backend.workspace.application.WorkspaceAuthorizationService;
import com.freelanceops.backend.workspace.domain.AuthorizationDecision;
import com.freelanceops.backend.workspace.domain.PermissionCode;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class InternalToolServiceTest {

    private final ProjectRepository projectRepository = mock(ProjectRepository.class);
    private final WorkspaceAuthorizationService authorizationService = mock(WorkspaceAuthorizationService.class);
    private final InternalToolService service = new InternalToolService(projectRepository, authorizationService);

    @Test
    void getsProjectOnlyThroughWorkspaceScopedRepositoryAndCurrentPermission() {
        DelegationPrincipal principal = principal(Set.of("agent.run", "project.read"));
        ProjectEntity project = new ProjectEntity(
            principal.projectId(), principal.workspaceId(), "테스트 프로젝트", "견적 요구사항", "KRW", null,
            new BigDecimal("1000000"), new BigDecimal("2000000")
        );
        when(projectRepository.findByIdAndWorkspaceId(principal.projectId(), principal.workspaceId()))
            .thenReturn(Optional.of(project));
        when(authorizationService.authorize(
            principal.initiatedBy(), principal.workspaceId(), PermissionCode.PROJECT_READ, principal.workspaceId()
        )).thenReturn(AuthorizationDecision.ALLOWED);

        ToolContracts.ProjectContext result = service.getProjectContext(principal.projectId(), principal);

        assertThat(result.title()).isEqualTo("테스트 프로젝트");
        verify(projectRepository).findByIdAndWorkspaceId(principal.projectId(), principal.workspaceId());
        verify(authorizationService).authorize(
            principal.initiatedBy(), principal.workspaceId(), PermissionCode.PROJECT_READ, principal.workspaceId()
        );
    }

    @Test
    void rejectsAProjectThatIsNotBoundToTheRunBeforeRepositoryAccess() {
        DelegationPrincipal principal = principal(Set.of("agent.run", "project.read"));

        assertThatThrownBy(() -> service.getProjectContext(UUID.randomUUID(), principal))
            .isInstanceOf(ToolAccessException.class)
            .hasMessage("PROJECT_NOT_FOUND");
        verifyNoInteractions(projectRepository, authorizationService);
    }

    @Test
    void rejectsRevokedCurrentPermissionEvenWhenTokenStillContainsIt() {
        DelegationPrincipal principal = principal(Set.of("agent.run", "project.read"));
        ProjectEntity project = new ProjectEntity(
            principal.projectId(), principal.workspaceId(), "테스트 프로젝트", "요구사항", "KRW", null, null, null
        );
        when(projectRepository.findByIdAndWorkspaceId(principal.projectId(), principal.workspaceId()))
            .thenReturn(Optional.of(project));
        when(authorizationService.authorize(
            principal.initiatedBy(), principal.workspaceId(), PermissionCode.PROJECT_READ, principal.workspaceId()
        )).thenReturn(AuthorizationDecision.FORBIDDEN);

        assertThatThrownBy(() -> service.getProjectContext(principal.projectId(), principal))
            .isInstanceOf(ToolAccessException.class)
            .hasMessage("TOOL_PERMISSION_REQUIRED");
    }

    @Test
    void calculatesQuoteWithDeterministicMoneyRounding() {
        DelegationPrincipal principal = principal(Set.of("agent.run", "quotation.write"));
        when(authorizationService.authorize(
            principal.initiatedBy(), principal.workspaceId(), PermissionCode.QUOTATION_WRITE, principal.workspaceId()
        )).thenReturn(AuthorizationDecision.ALLOWED);
        ToolContracts.QuoteCalculationRequest request = new ToolContracts.QuoteCalculationRequest(
            "KRW", new BigDecimal("0.1"), new BigDecimal("0.05"),
            List.of(
                new ToolContracts.QuoteCalculationItem(UUID.randomUUID(), new BigDecimal("2"), new BigDecimal("1000")),
                new ToolContracts.QuoteCalculationItem(UUID.randomUUID(), new BigDecimal("1.5"), new BigDecimal("500"))
            )
        );

        ToolContracts.QuoteCalculationResult result = service.calculateQuote(request, principal);

        assertThat(result.subtotal()).isEqualByComparingTo("2750.00");
        assertThat(result.discountAmount()).isEqualByComparingTo("137.50");
        assertThat(result.taxAmount()).isEqualByComparingTo("261.25");
        assertThat(result.total()).isEqualByComparingTo("2873.75");
        assertThat(result.formulaVersion()).isEqualTo("quote-v1.0.0");
    }

    @Test
    void validatesRequirementsDeterministically() {
        DelegationPrincipal principal = principal(Set.of("agent.run", "project.read"));
        ProjectEntity project = new ProjectEntity(
            principal.projectId(), principal.workspaceId(), "테스트", "원문", "KRW", null, null, null
        );
        when(projectRepository.findByIdAndWorkspaceId(principal.projectId(), principal.workspaceId()))
            .thenReturn(Optional.of(project));
        when(authorizationService.authorize(
            principal.initiatedBy(), principal.workspaceId(), PermissionCode.PROJECT_READ, principal.workspaceId()
        )).thenReturn(AuthorizationDecision.ALLOWED);
        ToolContracts.RequirementDraft draft = new ToolContracts.RequirementDraft(
            principal.projectId(), "요약", List.of(), List.of(), List.of(), List.of("예산은 얼마인가요?")
        );

        ToolContracts.RequirementValidationResult result = service.validateRequirements(draft, principal);

        assertThat(result.valid()).isFalse();
        assertThat(result.errors()).containsExactly("FEATURE_REQUIRED");
        assertThat(result.warnings()).containsExactly("OPEN_QUESTIONS_REMAIN", "ASSUMPTIONS_NOT_DECLARED");
    }

    private static DelegationPrincipal principal(Set<String> permissions) {
        UUID initiatedBy = UUID.randomUUID();
        return new DelegationPrincipal(
            initiatedBy.toString(), UUID.randomUUID().toString(), UUID.randomUUID(), UUID.randomUUID(),
            UUID.randomUUID(), initiatedBy, permissions
        );
    }
}
