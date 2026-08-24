package com.freelanceops.backend.domain.proposal.service;

import com.freelanceops.backend.domain.project.entity.ProjectEntity;
import com.freelanceops.backend.domain.project.repository.ProjectRepository;
import com.freelanceops.backend.domain.proposal.entity.ProposalShareEntity;
import com.freelanceops.backend.domain.proposal.repository.ProposalShareRepository;
import com.freelanceops.backend.domain.proposal.repository.ProposalDecisionRepository;
import com.freelanceops.backend.domain.proposal.model.ProposalDecision;
import com.freelanceops.backend.domain.quotation.dto.response.QuotationBasisResponse;
import com.freelanceops.backend.domain.quotation.dto.response.QuotationItemResponse;
import com.freelanceops.backend.domain.quotation.dto.response.QuotationResponse;
import com.freelanceops.backend.domain.quotation.model.BasisType;
import com.freelanceops.backend.domain.quotation.model.QuotationScenario;
import com.freelanceops.backend.domain.quotation.model.QuotationStatus;
import com.freelanceops.backend.domain.quotation.model.WorkUnit;
import com.freelanceops.backend.domain.quotation.service.QuotationService;
import com.freelanceops.backend.domain.workspace.service.WorkspaceAuthorizationService;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class ProposalShareServiceTest {

    @Test
    void returnsTokenOnceButPersistsOnlyHashAndServesPublishedProposal() {
        ProposalShareRepository shareRepository = mock(ProposalShareRepository.class);
        ProjectRepository projectRepository = mock(ProjectRepository.class);
        QuotationService quotationService = mock(QuotationService.class);
        WorkspaceAuthorizationService authorizationService = mock(WorkspaceAuthorizationService.class);
        ProposalDecisionRepository decisionRepository = mock(ProposalDecisionRepository.class);
        ProposalShareService service = new ProposalShareService(
            shareRepository,
            projectRepository,
            quotationService,
            authorizationService,
            decisionRepository
        );
        UUID userId = UUID.randomUUID();
        UUID workspaceId = UUID.randomUUID();
        UUID projectId = UUID.randomUUID();
        UUID quotationId = UUID.randomUUID();
        QuotationResponse quotation = quotation(workspaceId, projectId, quotationId);
        when(quotationService.getPublishedForShare(userId, workspaceId, quotationId)).thenReturn(quotation);
        when(quotationService.getPublishedInternal(workspaceId, quotationId)).thenReturn(quotation);
        when(shareRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));

        var created = service.create(userId, workspaceId, quotationId, 3);

        ArgumentCaptor<ProposalShareEntity> captor = ArgumentCaptor.forClass(ProposalShareEntity.class);
        org.mockito.Mockito.verify(shareRepository).save(captor.capture());
        ProposalShareEntity persisted = captor.getValue();
        assertThat(created.token()).hasSize(43);
        assertThat(persisted.tokenHash()).isEqualTo(ProposalShareService.hash(created.token()));
        assertThat(persisted.tokenHash()).doesNotContain(created.token());
        when(shareRepository.findByTokenHash(anyString())).thenReturn(Optional.of(persisted));
        when(shareRepository.findByTokenHashForUpdate(anyString())).thenReturn(Optional.of(persisted));
        when(projectRepository.findByIdAndWorkspaceId(projectId, workspaceId)).thenReturn(Optional.of(
            new ProjectEntity(projectId, workspaceId, "고객 프로젝트", "요구사항", "KRW", null, null, null)
        ));

        var shared = service.get(created.token());

        assertThat(shared.projectTitle()).isEqualTo("고객 프로젝트");
        assertThat(shared.total()).isEqualByComparingTo("110000.00");
        assertThat(shared.items()).hasSize(1);
        assertThat(shared.items().getFirst().basis().type()).isEqualTo(BasisType.ASSUMPTION);

        when(decisionRepository.saveAndFlush(any())).thenAnswer(invocation -> invocation.getArgument(0));
        var decision = service.decide(
            created.token(),
            ProposalDecision.APPROVED,
            "고객 담당자",
            "client@example.com",
            "승인합니다."
        );

        assertThat(decision.decision()).isEqualTo(ProposalDecision.APPROVED);
        assertThat(decision.quotationId()).isEqualTo(quotationId);
    }

    @Test
    void maps_a_concurrent_duplicate_decision_to_conflict() {
        ProposalShareRepository shareRepository = mock(ProposalShareRepository.class);
        ProjectRepository projectRepository = mock(ProjectRepository.class);
        QuotationService quotationService = mock(QuotationService.class);
        WorkspaceAuthorizationService authorizationService = mock(WorkspaceAuthorizationService.class);
        ProposalDecisionRepository decisionRepository = mock(ProposalDecisionRepository.class);
        ProposalShareService service = new ProposalShareService(
            shareRepository, projectRepository, quotationService, authorizationService, decisionRepository
        );
        String token = "a".repeat(43);
        UUID workspaceId = UUID.randomUUID();
        UUID projectId = UUID.randomUUID();
        UUID quotationId = UUID.randomUUID();
        ProposalShareEntity share = new ProposalShareEntity(
            UUID.randomUUID(), workspaceId, quotationId, ProposalShareService.hash(token),
            Instant.now().plusSeconds(3600), UUID.randomUUID(), Instant.now()
        );
        when(shareRepository.findByTokenHashForUpdate(ProposalShareService.hash(token))).thenReturn(Optional.of(share));
        when(quotationService.getPublishedInternal(workspaceId, quotationId)).thenReturn(quotation(workspaceId, projectId, quotationId));
        when(decisionRepository.saveAndFlush(any())).thenThrow(new DataIntegrityViolationException("duplicate"));

        assertThatThrownBy(() -> service.decide(token, ProposalDecision.APPROVED, "고객", null, null))
            .isInstanceOfSatisfying(ResponseStatusException.class, error ->
                assertThat(error.getStatusCode().value()).isEqualTo(409));
    }

    private static QuotationResponse quotation(UUID workspaceId, UUID projectId, UUID quotationId) {
        QuotationBasisResponse basis = new QuotationBasisResponse(
            BasisType.ASSUMPTION,
            "고객 제공 자료 기준",
            null,
            null,
            null,
            null
        );
        QuotationItemResponse item = new QuotationItemResponse(
            null,
            "구현",
            "핵심 기능 구현",
            BigDecimal.ONE,
            WorkUnit.FIXED,
            new BigDecimal("100000.00"),
            new BigDecimal("100000.00"),
            BigDecimal.ZERO,
            BigDecimal.ZERO,
            new BigDecimal("100000.00"),
            basis
        );
        return new QuotationResponse(
            quotationId,
            workspaceId,
            projectId,
            quotationId,
            null,
            1,
            QuotationScenario.RECOMMENDED,
            QuotationStatus.PUBLISHED,
            "KRW",
            new BigDecimal("100000.00"),
            BigDecimal.ZERO,
            BigDecimal.ZERO,
            BigDecimal.ZERO,
            new BigDecimal("0.100000"),
            new BigDecimal("10000.00"),
            new BigDecimal("110000.00"),
            LocalDate.now().plusDays(7),
            List.of(item),
            Instant.now(),
            UUID.randomUUID(),
            Instant.now(),
            0
        );
    }
}
