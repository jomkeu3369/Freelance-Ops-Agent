package com.freelanceops.backend.domain.quotation.service;

import com.freelanceops.backend.domain.quotation.dto.request.ConfirmEstimationPolicyProposalRequest;
import com.freelanceops.backend.domain.quotation.dto.request.ProposeEstimationPolicyRequest;
import com.freelanceops.backend.domain.quotation.dto.response.EstimationPolicyProposalResponse;
import com.freelanceops.backend.domain.quotation.dto.response.EstimationPolicyResponse;
import com.freelanceops.backend.domain.quotation.entity.EstimationPolicyEntity;
import com.freelanceops.backend.domain.quotation.entity.EstimationPolicyProposalEntity;
import com.freelanceops.backend.domain.quotation.repository.EstimationPolicyProposalRepository;
import com.freelanceops.backend.domain.quotation.repository.EstimationPolicyRepository;
import com.freelanceops.backend.domain.project.repository.ProjectRepository;
import com.freelanceops.backend.domain.workspace.policy.AuthorizationDecision;
import com.freelanceops.backend.domain.workspace.policy.PermissionCode;
import com.freelanceops.backend.domain.workspace.repository.WorkspaceRepository;
import com.freelanceops.backend.domain.workspace.service.WorkspaceAuthorizationService;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.Optional;
import java.util.List;
import java.util.UUID;

/** The UI may propose values, but only this authenticated confirmation can write the policy. */
@Service
public class EstimationPolicyProposalService {
    private static final BigDecimal DEFAULT_MAXIMUM_DISCOUNT = new BigDecimal("0.300000");
    private static final Duration PROPOSAL_LIFETIME = Duration.ofMinutes(30);
    private final EstimationPolicyProposalRepository proposalRepository;
    private final EstimationPolicyRepository policyRepository;
    private final WorkspaceAuthorizationService authorizationService;
    private final WorkspaceRepository workspaceRepository;
    private final ProjectRepository projectRepository;

    public EstimationPolicyProposalService(EstimationPolicyProposalRepository proposalRepository,
        EstimationPolicyRepository policyRepository, WorkspaceAuthorizationService authorizationService,
        WorkspaceRepository workspaceRepository, ProjectRepository projectRepository) {
        this.proposalRepository = proposalRepository;
        this.policyRepository = policyRepository;
        this.authorizationService = authorizationService;
        this.workspaceRepository = workspaceRepository;
        this.projectRepository = projectRepository;
    }

    @Transactional
    public EstimationPolicyProposalResponse propose(UUID userId, UUID workspaceId, ProposeEstimationPolicyRequest request) {
        authorize(userId, workspaceId, PermissionCode.QUOTATION_WRITE);
        validate(request);
        validateProject(userId, workspaceId, request.projectId());
        lockWorkspace(workspaceId);
        Optional<EstimationPolicyProposalEntity> prior = proposalRepository
            .findByWorkspaceIdAndCreatedByAndIdempotencyKey(workspaceId, userId, request.idempotencyKey());
        if (prior.isPresent()) {
            EstimationPolicyProposalEntity entity = prior.get();
            if (!entity.projectId().equals(request.projectId())
                || !entity.sourceMessage().equals(request.sourceMessage())
                || entity.baseVersion() != request.expectedVersion()
                || !same(entity.proposedTaxRate(), request.defaultTaxRate())
                || !same(entity.proposedRiskBufferRate(), request.defaultRiskBufferRate())
                || !same(entity.proposedMaximumDiscountRate(), request.maximumDiscountRate())) {
                throw new ResponseStatusException(HttpStatus.CONFLICT, "idempotency key reused for a different change");
            }
            return response(entity);
        }
        EstimationPolicyResponse current = currentPolicy(workspaceId);
        if (current.version() != request.expectedVersion()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "estimation policy revision changed");
        }
        if (same(current.defaultTaxRate(), request.defaultTaxRate())
            && same(current.defaultRiskBufferRate(), request.defaultRiskBufferRate())
            && same(current.maximumDiscountRate(), request.maximumDiscountRate())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "proposal has no changes");
        }
        Instant now = Instant.now();
        EstimationPolicyProposalEntity entity = new EstimationPolicyProposalEntity(
            UUID.randomUUID(), workspaceId, request.projectId(), request.sourceMessage(),
            userId, request.idempotencyKey(), UUID.randomUUID(),
            current.version(), current.defaultTaxRate(), current.defaultRiskBufferRate(), current.maximumDiscountRate(),
            request.defaultTaxRate(), request.defaultRiskBufferRate(), request.maximumDiscountRate(),
            now, now.plus(PROPOSAL_LIFETIME)
        );
        return response(proposalRepository.save(entity));
    }

    @Transactional(readOnly = true)
    public EstimationPolicyProposalResponse get(UUID userId, UUID workspaceId, UUID proposalId) {
        authorize(userId, workspaceId, PermissionCode.QUOTATION_READ);
        EstimationPolicyProposalEntity proposal = ownedProposal(userId, workspaceId, proposalId);
        validateProject(userId, workspaceId, proposal.projectId());
        return response(proposal);
    }

    @Transactional(readOnly = true)
    public List<EstimationPolicyProposalResponse> listRecent(UUID userId, UUID workspaceId, UUID projectId) {
        authorize(userId, workspaceId, PermissionCode.QUOTATION_READ);
        validateProject(userId, workspaceId, projectId);
        return proposalRepository.findTop20ByWorkspaceIdAndProjectIdAndCreatedByOrderByCreatedAtDesc(
            workspaceId, projectId, userId).stream().map(EstimationPolicyProposalService::response).toList();
    }

    @Transactional
    public EstimationPolicyProposalResponse confirm(UUID userId, UUID workspaceId, UUID proposalId,
        ConfirmEstimationPolicyProposalRequest request) {
        authorize(userId, workspaceId, PermissionCode.QUOTATION_WRITE);
        if (request == null || request.confirmationToken() == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "confirmation token is required");
        }
        // All policy writes, including the existing PUT, serialize on the workspace row.
        lockWorkspace(workspaceId);
        EstimationPolicyProposalEntity proposal = ownedProposal(userId, workspaceId, proposalId);
        validateProject(userId, workspaceId, proposal.projectId());
        if (!proposal.confirmationToken().equals(request.confirmationToken())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "confirmation does not match the reviewed proposal");
        }
        if ("APPLIED".equals(proposal.status())) return response(proposal);
        if (!Instant.now().isBefore(proposal.expiresAt())) {
            throw new ResponseStatusException(HttpStatus.GONE, "proposal expired");
        }
        EstimationPolicyResponse current = currentPolicy(workspaceId);
        if (current.version() != proposal.baseVersion()
            || !same(current.defaultTaxRate(), proposal.beforeTaxRate())
            || !same(current.defaultRiskBufferRate(), proposal.beforeRiskBufferRate())
            || !same(current.maximumDiscountRate(), proposal.beforeMaximumDiscountRate())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "estimation policy changed; review a new proposal");
        }
        Instant now = Instant.now();
        EstimationPolicyEntity policy = policyRepository.findById(workspaceId)
            .orElseGet(() -> new EstimationPolicyEntity(workspaceId, proposal.proposedTaxRate(),
                proposal.proposedRiskBufferRate(), proposal.proposedMaximumDiscountRate(), userId, now));
        policy.update(proposal.proposedTaxRate(), proposal.proposedRiskBufferRate(), proposal.proposedMaximumDiscountRate(), now);
        policy = policyRepository.saveAndFlush(policy);
        proposal.markApplied(now, policy.version());
        return response(proposalRepository.save(proposal));
    }

    private EstimationPolicyProposalEntity ownedProposal(UUID userId, UUID workspaceId, UUID proposalId) {
        EstimationPolicyProposalEntity entity = proposalRepository.findByIdAndWorkspaceId(proposalId, workspaceId)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        if (!entity.createdBy().equals(userId)) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        return entity;
    }

    private EstimationPolicyResponse currentPolicy(UUID workspaceId) {
        return policyRepository.findById(workspaceId)
            .map(entity -> new EstimationPolicyResponse(workspaceId, entity.defaultTaxRate(),
                entity.defaultRiskBufferRate(), entity.maximumDiscountRate(), entity.version()))
            .orElse(new EstimationPolicyResponse(workspaceId, BigDecimal.ZERO, BigDecimal.ZERO,
                DEFAULT_MAXIMUM_DISCOUNT, 0));
    }

    private void authorize(UUID userId, UUID workspaceId, PermissionCode permission) {
        AuthorizationDecision decision = authorizationService.authorize(userId, workspaceId, permission);
        if (decision == AuthorizationDecision.NOT_FOUND) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        if (decision == AuthorizationDecision.FORBIDDEN) throw new ResponseStatusException(HttpStatus.FORBIDDEN);
    }

    private void validateProject(UUID userId, UUID workspaceId, UUID projectId) {
        authorize(userId, workspaceId, PermissionCode.PROJECT_READ);
        if (projectRepository.findByIdAndWorkspaceId(projectId, workspaceId).isEmpty()) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        }
    }

    private void lockWorkspace(UUID workspaceId) {
        if (workspaceRepository.findByIdForUpdate(workspaceId).isEmpty()) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        }
    }

    private static void validate(ProposeEstimationPolicyRequest request) {
        if (request == null || request.expectedVersion() == null || request.expectedVersion() < 0
            || request.idempotencyKey() == null || request.projectId() == null
            || request.sourceMessage() == null || request.sourceMessage().isBlank()
            || request.sourceMessage().length() > 50000) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "invalid policy proposal");
        }
        validateRate(request.defaultTaxRate());
        validateRate(request.defaultRiskBufferRate());
        validateRate(request.maximumDiscountRate());
    }

    private static void validateRate(BigDecimal rate) {
        if (rate == null || rate.compareTo(BigDecimal.ZERO) < 0 || rate.compareTo(BigDecimal.ONE) > 0
            || rate.scale() > 6) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "rate must be between 0 and 1 with up to six decimal places");
        }
    }

    private static boolean same(BigDecimal left, BigDecimal right) {
        return left.compareTo(right) == 0;
    }

    private static EstimationPolicyProposalResponse response(EstimationPolicyProposalEntity entity) {
        EstimationPolicyResponse before = new EstimationPolicyResponse(entity.workspaceId(), entity.beforeTaxRate(),
            entity.beforeRiskBufferRate(), entity.beforeMaximumDiscountRate(), entity.baseVersion());
        EstimationPolicyResponse after = new EstimationPolicyResponse(entity.workspaceId(), entity.proposedTaxRate(),
            entity.proposedRiskBufferRate(), entity.proposedMaximumDiscountRate(),
            entity.appliedPolicyVersion() == null ? entity.baseVersion() : entity.appliedPolicyVersion());
        return new EstimationPolicyProposalResponse(entity.id(), entity.workspaceId(), entity.projectId(),
            entity.sourceMessage(), entity.status(), before, after, entity.confirmationToken(),
            entity.createdAt(), entity.expiresAt(), entity.appliedAt());
    }
}
