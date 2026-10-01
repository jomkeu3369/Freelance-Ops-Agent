package com.freelanceops.backend.domain.quotation.service;

import com.freelanceops.backend.domain.quotation.dto.request.ConfirmEstimationPolicyProposalRequest;
import com.freelanceops.backend.domain.quotation.dto.request.ProposeEstimationPolicyRequest;
import com.freelanceops.backend.domain.quotation.dto.response.EstimationPolicyProposalResponse;
import com.freelanceops.backend.domain.quotation.entity.EstimationPolicyEntity;
import com.freelanceops.backend.domain.quotation.entity.EstimationPolicyProposalEntity;
import com.freelanceops.backend.domain.quotation.repository.EstimationPolicyProposalRepository;
import com.freelanceops.backend.domain.quotation.repository.EstimationPolicyRepository;
import com.freelanceops.backend.domain.project.entity.ProjectEntity;
import com.freelanceops.backend.domain.project.repository.ProjectRepository;
import com.freelanceops.backend.domain.workspace.entity.WorkspaceEntity;
import com.freelanceops.backend.domain.workspace.policy.AuthorizationDecision;
import com.freelanceops.backend.domain.workspace.policy.PermissionCode;
import com.freelanceops.backend.domain.workspace.repository.WorkspaceRepository;
import com.freelanceops.backend.domain.workspace.service.WorkspaceAuthorizationService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.Optional;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.mock;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class EstimationPolicyProposalServiceTest {
    @Mock private EstimationPolicyProposalRepository proposalRepository;
    @Mock private EstimationPolicyRepository policyRepository;
    @Mock private WorkspaceAuthorizationService authorizationService;
    @Mock private WorkspaceRepository workspaceRepository;
    @Mock private ProjectRepository projectRepository;

    private final UUID userId = UUID.randomUUID();
    private final UUID workspaceId = UUID.randomUUID();
    private final UUID projectId = UUID.randomUUID();
    private final AtomicReference<EstimationPolicyProposalEntity> storedProposal = new AtomicReference<>();
    private final AtomicReference<EstimationPolicyEntity> storedPolicy = new AtomicReference<>();
    private EstimationPolicyProposalService service;

    @BeforeEach
    void setUp() {
        service = new EstimationPolicyProposalService(proposalRepository, policyRepository,
            authorizationService, workspaceRepository, projectRepository);
        when(authorizationService.authorize(userId, workspaceId, PermissionCode.QUOTATION_WRITE))
            .thenReturn(AuthorizationDecision.ALLOWED);
        when(authorizationService.authorize(userId, workspaceId, PermissionCode.QUOTATION_READ))
            .thenReturn(AuthorizationDecision.ALLOWED);
        when(authorizationService.authorize(userId, workspaceId, PermissionCode.PROJECT_READ))
            .thenReturn(AuthorizationDecision.ALLOWED);
    }

    @Test
    void requiresConfirmationBeforeWritingAndAppliesOnlyReviewedValues() {
        arrangeStorage();
        EstimationPolicyProposalResponse proposal = service.propose(userId, workspaceId, change(UUID.randomUUID()));
        assertEquals("PENDING", proposal.status());
        assertEquals(0, proposal.after().defaultTaxRate().compareTo(rate("0.1")));
        verify(policyRepository, never()).saveAndFlush(any());

        EstimationPolicyProposalResponse result = service.confirm(userId, workspaceId, proposal.proposalId(),
            new ConfirmEstimationPolicyProposalRequest(proposal.confirmationToken()));
        assertEquals("APPLIED", result.status());
        assertEquals(0, storedPolicy.get().defaultTaxRate().compareTo(rate("0.1")));
        verify(policyRepository, times(1)).saveAndFlush(any());
    }

    @Test
    void rejectsForgedApprovalTokenWithoutWriting() {
        arrangeStorage();
        EstimationPolicyProposalResponse proposal = service.propose(userId, workspaceId, change(UUID.randomUUID()));
        ResponseStatusException error = assertThrows(ResponseStatusException.class,
            () -> service.confirm(userId, workspaceId, proposal.proposalId(),
                new ConfirmEstimationPolicyProposalRequest(UUID.randomUUID())));
        assertEquals(HttpStatus.FORBIDDEN, error.getStatusCode());
        verify(policyRepository, never()).saveAndFlush(any());
    }

    @Test
    void duplicateConfirmationIsIdempotent() {
        arrangeStorage();
        EstimationPolicyProposalResponse proposal = service.propose(userId, workspaceId, change(UUID.randomUUID()));
        ConfirmEstimationPolicyProposalRequest confirmation = new ConfirmEstimationPolicyProposalRequest(proposal.confirmationToken());
        service.confirm(userId, workspaceId, proposal.proposalId(), confirmation);
        EstimationPolicyProposalResponse replay = service.confirm(userId, workspaceId, proposal.proposalId(), confirmation);
        assertEquals("APPLIED", replay.status());
        verify(policyRepository, times(1)).saveAndFlush(any());
    }

    @Test
    void crossTenantAndOtherUserCannotReadOrConfirmProposal() {
        arrangeStorage();
        EstimationPolicyProposalResponse proposal = service.propose(userId, workspaceId, change(UUID.randomUUID()));
        UUID otherWorkspace = UUID.randomUUID();
        when(authorizationService.authorize(userId, otherWorkspace, PermissionCode.QUOTATION_READ))
            .thenReturn(AuthorizationDecision.ALLOWED);
        ResponseStatusException crossTenant = assertThrows(ResponseStatusException.class,
            () -> service.get(userId, otherWorkspace, proposal.proposalId()));
        assertEquals(HttpStatus.NOT_FOUND, crossTenant.getStatusCode());

        UUID otherUser = UUID.randomUUID();
        when(authorizationService.authorize(otherUser, workspaceId, PermissionCode.QUOTATION_WRITE))
            .thenReturn(AuthorizationDecision.ALLOWED);
        ResponseStatusException otherUserError = assertThrows(ResponseStatusException.class,
            () -> service.confirm(otherUser, workspaceId, proposal.proposalId(),
                new ConfirmEstimationPolicyProposalRequest(proposal.confirmationToken())));
        assertEquals(HttpStatus.NOT_FOUND, otherUserError.getStatusCode());
        verify(policyRepository, never()).saveAndFlush(any());
    }

    @Test
    void rejectsStaleRevisionAtProposalAndConfirmation() {
        arrangeStorage();
        ResponseStatusException initial = assertThrows(ResponseStatusException.class,
            () -> service.propose(userId, workspaceId,
                new ProposeEstimationPolicyRequest(rate("0.1"), rate("0.2"), rate("0.3"), 1L,
                    UUID.randomUUID(), projectId, "set tax")));
        assertEquals(HttpStatus.CONFLICT, initial.getStatusCode());
        EstimationPolicyProposalResponse proposal = service.propose(userId, workspaceId, change(UUID.randomUUID()));
        storedPolicy.set(new EstimationPolicyEntity(workspaceId, rate("0.2"), rate("0.2"), rate("0.3"), userId, Instant.now()));
        ResponseStatusException changed = assertThrows(ResponseStatusException.class,
            () -> service.confirm(userId, workspaceId, proposal.proposalId(),
                new ConfirmEstimationPolicyProposalRequest(proposal.confirmationToken())));
        assertEquals(HttpStatus.CONFLICT, changed.getStatusCode());
        verify(policyRepository, never()).saveAndFlush(any());
    }

    @Test
    void idempotencyKeyCannotBeReusedForDifferentContent() {
        arrangeStorage();
        UUID key = UUID.randomUUID();
        EstimationPolicyProposalResponse proposal = service.propose(userId, workspaceId, change(key));
        assertEquals(proposal.proposalId(), service.propose(userId, workspaceId, change(key)).proposalId());
        ResponseStatusException error = assertThrows(ResponseStatusException.class,
            () -> service.propose(userId, workspaceId,
                new ProposeEstimationPolicyRequest(rate("0.2"), rate("0.2"), rate("0.3"), 0L,
                    key, projectId, "set tax")));
        assertEquals(HttpStatus.CONFLICT, error.getStatusCode());
    }

    @Test
    void noPermissionMeansNoProposalAccess() {
        when(authorizationService.authorize(userId, workspaceId, PermissionCode.QUOTATION_WRITE))
            .thenReturn(AuthorizationDecision.FORBIDDEN);
        ResponseStatusException error = assertThrows(ResponseStatusException.class,
            () -> service.propose(userId, workspaceId, change(UUID.randomUUID())));
        assertEquals(HttpStatus.FORBIDDEN, error.getStatusCode());
        verify(proposalRepository, never()).save(any());
    }

    @Test
    void revokingWritePermissionAfterProposalBlocksConfirmation() {
        arrangeStorage();
        EstimationPolicyProposalResponse proposal = service.propose(userId, workspaceId, change(UUID.randomUUID()));
        when(authorizationService.authorize(userId, workspaceId, PermissionCode.QUOTATION_WRITE))
            .thenReturn(AuthorizationDecision.FORBIDDEN);
        ResponseStatusException error = assertThrows(ResponseStatusException.class,
            () -> service.confirm(userId, workspaceId, proposal.proposalId(),
                new ConfirmEstimationPolicyProposalRequest(proposal.confirmationToken())));
        assertEquals(HttpStatus.FORBIDDEN, error.getStatusCode());
        verify(policyRepository, never()).saveAndFlush(any());
    }

    @Test
    void persistsVerbatimMessageAndReturnsAppliedProjectHistoryToCreatorOnly() {
        arrangeStorage();
        String original = "  기본 세율 10%로 바꿔 줘.\n";
        EstimationPolicyProposalResponse proposal = service.propose(userId, workspaceId,
            new ProposeEstimationPolicyRequest(rate("0.1"), rate("0.2"), rate("0.3"), 0L,
                UUID.randomUUID(), projectId, original));
        assertEquals(original, proposal.sourceMessage());
        service.confirm(userId, workspaceId, proposal.proposalId(),
            new ConfirmEstimationPolicyProposalRequest(proposal.confirmationToken()));
        List<EstimationPolicyProposalResponse> history = service.listRecent(userId, workspaceId, projectId);
        assertEquals(1, history.size());
        assertEquals("APPLIED", history.getFirst().status());
        assertEquals(original, history.getFirst().sourceMessage());
    }

    @Test
    void projectOutsideWorkspaceCannotReceiveProposal() {
        arrangeStorage();
        UUID foreignProjectId = UUID.randomUUID();
        ResponseStatusException error = assertThrows(ResponseStatusException.class,
            () -> service.propose(userId, workspaceId,
                new ProposeEstimationPolicyRequest(rate("0.1"), rate("0.2"), rate("0.3"), 0L,
                    UUID.randomUUID(), foreignProjectId, "set tax")));
        assertEquals(HttpStatus.NOT_FOUND, error.getStatusCode());
        verify(proposalRepository, never()).save(any());
    }

    @Test
    void projectHistoryExcludesOtherCreatorsAndOtherProjects() {
        arrangeStorage();
        service.propose(userId, workspaceId, change(UUID.randomUUID()));
        UUID otherUser = UUID.randomUUID();
        when(authorizationService.authorize(otherUser, workspaceId, PermissionCode.QUOTATION_READ))
            .thenReturn(AuthorizationDecision.ALLOWED);
        when(authorizationService.authorize(otherUser, workspaceId, PermissionCode.PROJECT_READ))
            .thenReturn(AuthorizationDecision.ALLOWED);
        assertEquals(List.of(), service.listRecent(otherUser, workspaceId, projectId));
        UUID otherProject = UUID.randomUUID();
        when(projectRepository.findByIdAndWorkspaceId(otherProject, workspaceId))
            .thenReturn(Optional.of(mock(ProjectEntity.class)));
        assertEquals(List.of(), service.listRecent(userId, workspaceId, otherProject));
    }

    private void arrangeStorage() {
        when(projectRepository.findByIdAndWorkspaceId(any(), any()))
            .thenAnswer(call -> projectId.equals(call.getArgument(0)) && workspaceId.equals(call.getArgument(1))
                ? Optional.of(mock(ProjectEntity.class)) : Optional.empty());
        when(workspaceRepository.findByIdForUpdate(workspaceId)).thenReturn(Optional.of(
            WorkspaceEntity.active(workspaceId, "Workspace", "workspace", userId)));
        when(policyRepository.findById(workspaceId)).thenAnswer(call -> Optional.ofNullable(storedPolicy.get()));
        when(proposalRepository.findByWorkspaceIdAndCreatedByAndIdempotencyKey(any(), any(), any()))
            .thenAnswer(call -> Optional.ofNullable(storedProposal.get())
                .filter(proposal -> proposal.workspaceId().equals(call.getArgument(0)))
                .filter(proposal -> proposal.createdBy().equals(call.getArgument(1)))
                .filter(proposal -> proposal.idempotencyKey().equals(call.getArgument(2))));
        when(proposalRepository.findByIdAndWorkspaceId(any(), any()))
            .thenAnswer(call -> Optional.ofNullable(storedProposal.get())
                .filter(proposal -> proposal.id().equals(call.getArgument(0)))
                .filter(proposal -> proposal.workspaceId().equals(call.getArgument(1))));
        when(proposalRepository.save(any())).thenAnswer(call -> {
            EstimationPolicyProposalEntity proposal = call.getArgument(0);
            storedProposal.set(proposal);
            return proposal;
        });
        when(proposalRepository.findTop20ByWorkspaceIdAndProjectIdAndCreatedByOrderByCreatedAtDesc(any(), any(), any()))
            .thenAnswer(call -> Optional.ofNullable(storedProposal.get())
                .filter(proposal -> proposal.workspaceId().equals(call.getArgument(0)))
                .filter(proposal -> proposal.projectId().equals(call.getArgument(1)))
                .filter(proposal -> proposal.createdBy().equals(call.getArgument(2)))
                .map(List::of).orElseGet(List::of));
        when(policyRepository.saveAndFlush(any())).thenAnswer(call -> {
            EstimationPolicyEntity policy = call.getArgument(0);
            storedPolicy.set(policy);
            return policy;
        });
    }

    private ProposeEstimationPolicyRequest change(UUID key) {
        return new ProposeEstimationPolicyRequest(rate("0.1"), rate("0.2"), rate("0.3"), 0L,
            key, projectId, "set tax");
    }

    private static BigDecimal rate(String value) {
        return new BigDecimal(value);
    }
}
