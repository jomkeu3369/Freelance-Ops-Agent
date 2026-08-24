package com.freelanceops.backend.domain.quotation.service;

import com.freelanceops.backend.domain.project.repository.ProjectRepository;
import com.freelanceops.backend.domain.quotation.entity.QuotationEntity;
import com.freelanceops.backend.domain.quotation.repository.EstimationPolicyRepository;
import com.freelanceops.backend.domain.quotation.repository.QuotationAssumptionRepository;
import com.freelanceops.backend.domain.quotation.repository.QuotationEvidenceRepository;
import com.freelanceops.backend.domain.quotation.repository.QuotationItemRepository;
import com.freelanceops.backend.domain.quotation.repository.QuotationRepository;
import com.freelanceops.backend.domain.quotation.repository.RateCardRepository;
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
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class QuotationServiceTest {

    @Mock private ProjectRepository projectRepository;
    @Mock private QuotationRepository quotationRepository;
    @Mock private QuotationItemRepository itemRepository;
    @Mock private QuotationAssumptionRepository assumptionRepository;
    @Mock private QuotationEvidenceRepository evidenceRepository;
    @Mock private RateCardRepository rateCardRepository;
    @Mock private EstimationPolicyRepository policyRepository;
    @Mock private WorkspaceAuthorizationService authorizationService;
    @Mock private QuotationCalculator calculator;

    @Test
    void anOlderDraftCannotBePublishedAfterANewerVersionExists() {
        UUID userId = UUID.randomUUID();
        UUID workspaceId = UUID.randomUUID();
        UUID projectId = UUID.randomUUID();
        UUID seriesId = UUID.randomUUID();
        QuotationEntity older = quotation(UUID.randomUUID(), workspaceId, projectId, seriesId, null, 1);
        QuotationEntity latest = quotation(UUID.randomUUID(), workspaceId, projectId, seriesId, older.id(), 2);
        when(authorizationService.authorize(userId, workspaceId, PermissionCode.QUOTATION_PUBLISH))
            .thenReturn(AuthorizationDecision.ALLOWED);
        when(quotationRepository.findByIdAndWorkspaceIdForUpdate(older.id(), workspaceId))
            .thenReturn(Optional.of(older));
        when(quotationRepository.findTopByWorkspaceIdAndSeriesIdOrderByVersionNumberDesc(workspaceId, seriesId))
            .thenReturn(Optional.of(latest));

        assertThatThrownBy(() -> service().publish(userId, workspaceId, older.id()))
            .isInstanceOfSatisfying(ResponseStatusException.class, error ->
                assertThat(error.getStatusCode().value()).isEqualTo(409));

        assertThat(older.status()).isEqualTo("DRAFT");
        verify(projectRepository, never()).findByIdAndWorkspaceIdForUpdate(projectId, workspaceId);
    }

    private QuotationService service() {
        return new QuotationService(
            projectRepository, quotationRepository, itemRepository, assumptionRepository, evidenceRepository,
            rateCardRepository, policyRepository, authorizationService, calculator
        );
    }

    private static QuotationEntity quotation(UUID id, UUID workspaceId, UUID projectId, UUID seriesId,
                                               UUID previousId, int version) {
        return new QuotationEntity(
            id, workspaceId, projectId, seriesId, previousId, version, "RECOMMENDED", "KRW",
            new BigDecimal("100"), BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO,
            BigDecimal.ZERO, BigDecimal.ZERO, new BigDecimal("100"), null, UUID.randomUUID(), Instant.now()
        );
    }
}
