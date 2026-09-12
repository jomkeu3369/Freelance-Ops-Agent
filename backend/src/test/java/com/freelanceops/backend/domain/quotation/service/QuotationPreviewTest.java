package com.freelanceops.backend.domain.quotation.service;

import com.freelanceops.backend.domain.project.entity.ProjectEntity;
import com.freelanceops.backend.domain.project.repository.ProjectRepository;
import com.freelanceops.backend.domain.quotation.dto.request.*;
import com.freelanceops.backend.domain.quotation.entity.EstimationPolicyEntity;
import com.freelanceops.backend.domain.quotation.entity.RateCardEntity;
import com.freelanceops.backend.domain.quotation.model.*;
import com.freelanceops.backend.domain.quotation.repository.*;
import com.freelanceops.backend.domain.workspace.policy.AuthorizationDecision;
import com.freelanceops.backend.domain.workspace.policy.PermissionCode;
import com.freelanceops.backend.domain.workspace.service.WorkspaceAuthorizationService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.web.server.ResponseStatusException;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class QuotationPreviewTest {
    @Mock ProjectRepository projects;
    @Mock QuotationRepository quotations;
    @Mock QuotationItemRepository items;
    @Mock QuotationAssumptionRepository assumptions;
    @Mock QuotationEvidenceRepository evidence;
    @Mock RateCardRepository rates;
    @Mock EstimationPolicyRepository policies;
    @Mock WorkspaceAuthorizationService authorization;
    final UUID user = UUID.randomUUID(), workspace = UUID.randomUUID(), project = UUID.randomUUID();

    QuotationService service() {
        return new QuotationService(projects, quotations, items, assumptions, evidence, rates, policies, authorization, new QuotationCalculator());
    }

    void authorize() {
        when(authorization.authorize(user, workspace, PermissionCode.QUOTATION_READ)).thenReturn(AuthorizationDecision.ALLOWED);
        when(authorization.authorize(user, workspace, PermissionCode.QUOTATION_WRITE)).thenReturn(AuthorizationDecision.ALLOWED);
    }

    CreateQuotationRequest request(UUID rate) {
        return new CreateQuotationRequest(QuotationScenario.RECOMMENDED, "KRW", null, true, null,
            List.of(new QuotationItemRequest(rate, "예약", "", BigDecimal.ONE, WorkUnit.DAY, BigDecimal.ONE, new BigDecimal("0.1"),
                new QuotationBasisRequest(BasisType.ASSUMPTION, "예약 한 화면", null, null, null, null))));
    }

    @Test void previewUsesTrustedRateMinimumRiskAndTaxWithoutPersisting() {
        authorize();
        when(projects.findByIdAndWorkspaceId(project, workspace)).thenReturn(Optional.of(mock(ProjectEntity.class)));
        UUID rateId = UUID.randomUUID();
        when(rates.findByIdAndWorkspaceId(rateId, workspace)).thenReturn(Optional.of(new RateCardEntity(rateId, workspace, "개발", "DAY", new BigDecimal("100"), new BigDecimal("200"), "KRW", user, Instant.now())));
        when(policies.findById(workspace)).thenReturn(Optional.of(new EstimationPolicyEntity(workspace, new BigDecimal("0.1"), new BigDecimal("0.2"), new BigDecimal("0.3"), user, Instant.now())));
        var result = service().preview(user, workspace, project, request(rateId));
        assertThat(result.subtotal()).isEqualByComparingTo("200.00");
        assertThat(result.discountTotal()).isEqualByComparingTo("20.00");
        assertThat(result.riskBufferAmount()).isEqualByComparingTo("36.00");
        assertThat(result.taxAmount()).isEqualByComparingTo("21.60");
        assertThat(result.total()).isEqualByComparingTo("237.60");
        verifyNoInteractions(quotations, items, assumptions, evidence);
    }

    @Test void previewCannotReadAnotherWorkspacesProject() {
        authorize();
        when(projects.findByIdAndWorkspaceId(project, workspace)).thenReturn(Optional.empty());
        assertThatThrownBy(() -> service().preview(user, workspace, project, request(null)))
            .isInstanceOfSatisfying(ResponseStatusException.class, error -> assertThat(error.getStatusCode().value()).isEqualTo(404));
        verifyNoInteractions(rates, policies, quotations, items, assumptions, evidence);
    }

    @Test void previewRequiresWritePermissionBeforeLoadingBusinessData() {
        when(authorization.authorize(user, workspace, PermissionCode.QUOTATION_READ)).thenReturn(AuthorizationDecision.ALLOWED);
        when(authorization.authorize(user, workspace, PermissionCode.QUOTATION_WRITE)).thenReturn(AuthorizationDecision.FORBIDDEN);
        assertThatThrownBy(() -> service().preview(user, workspace, project, request(null)))
            .isInstanceOfSatisfying(ResponseStatusException.class, error -> assertThat(error.getStatusCode().value()).isEqualTo(403));
        verifyNoInteractions(projects, rates, policies, quotations, items, assumptions, evidence);
    }

    @Test void previewRejectsForeignRateCards() {
        authorize();
        when(projects.findByIdAndWorkspaceId(project, workspace)).thenReturn(Optional.of(mock(ProjectEntity.class)));
        when(policies.findById(workspace)).thenReturn(Optional.empty());
        UUID foreignRate = UUID.randomUUID();
        when(rates.findByIdAndWorkspaceId(foreignRate, workspace)).thenReturn(Optional.empty());
        assertThatThrownBy(() -> service().preview(user, workspace, project, request(foreignRate)))
            .isInstanceOfSatisfying(ResponseStatusException.class, error -> assertThat(error.getStatusCode().value()).isEqualTo(404));
        verifyNoInteractions(quotations, items, assumptions, evidence);
    }
}
