package com.freelanceops.backend.domain.outcome.service;

import com.freelanceops.backend.domain.outcome.dto.request.UpsertActualOutcomeRequest;
import com.freelanceops.backend.domain.outcome.repository.ActualOutcomeRepository;
import com.freelanceops.backend.domain.outcome.repository.ActualWorkItemRepository;
import com.freelanceops.backend.domain.project.entity.ProjectEntity;
import com.freelanceops.backend.domain.project.repository.ProjectRepository;
import com.freelanceops.backend.domain.quotation.repository.QuotationItemRepository;
import com.freelanceops.backend.domain.quotation.repository.QuotationRepository;
import com.freelanceops.backend.domain.workspace.policy.AuthorizationDecision;
import com.freelanceops.backend.domain.workspace.policy.PermissionCode;
import com.freelanceops.backend.domain.workspace.service.WorkspaceAuthorizationService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import java.math.BigDecimal;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class ActualOutcomeServiceTest {
    @Mock private ProjectRepository projectRepository;
    @Mock private QuotationRepository quotationRepository;
    @Mock private QuotationItemRepository quotationItemRepository;
    @Mock private ActualOutcomeRepository outcomeRepository;
    @Mock private ActualWorkItemRepository workItemRepository;
    @Mock private WorkspaceAuthorizationService authorizationService;

    @Test
    void computesProfitAndMarginFromActualValues() {
        UUID userId = UUID.randomUUID();
        UUID workspaceId = UUID.randomUUID();
        UUID projectId = UUID.randomUUID();
        when(authorizationService.authorize(userId, workspaceId, PermissionCode.OUTCOME_WRITE)).thenReturn(AuthorizationDecision.ALLOWED);
        when(projectRepository.findByIdAndWorkspaceIdForUpdate(projectId, workspaceId)).thenReturn(Optional.of(new ProjectEntity(projectId, workspaceId, "프로젝트", "요구사항", "KRW", null, null, null)));
        when(outcomeRepository.findByWorkspaceIdAndProjectId(workspaceId, projectId)).thenReturn(Optional.empty());
        when(outcomeRepository.saveAndFlush(any())).thenAnswer(invocation -> invocation.getArgument(0));
        ActualOutcomeService service = new ActualOutcomeService(projectRepository, quotationRepository, quotationItemRepository, outcomeRepository, workItemRepository, authorizationService);

        var response = service.upsert(userId, workspaceId, projectId, new UpsertActualOutcomeRequest(
            null, new BigDecimal("1000000"), new BigDecimal("600000"), new BigDecimal("80"), null, "범위 변경", List.of()
        ));

        assertThat(response.profitAmount()).isEqualByComparingTo("400000.00");
        assertThat(response.profitMargin()).isEqualByComparingTo("0.400000");
    }
}
