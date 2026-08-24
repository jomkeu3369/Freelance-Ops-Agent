package com.freelanceops.backend.domain.proposal.service;

import com.freelanceops.backend.domain.project.entity.ProjectEntity;
import com.freelanceops.backend.domain.project.repository.ProjectRepository;
import com.freelanceops.backend.domain.proposal.dto.response.ProposalShareCreatedResponse;
import com.freelanceops.backend.domain.proposal.dto.response.ProposalDecisionResponse;
import com.freelanceops.backend.domain.proposal.dto.response.SharedProposalItemResponse;
import com.freelanceops.backend.domain.proposal.dto.response.SharedProposalResponse;
import com.freelanceops.backend.domain.proposal.entity.ProposalShareEntity;
import com.freelanceops.backend.domain.proposal.entity.ProposalDecisionEntity;
import com.freelanceops.backend.domain.proposal.model.ProposalDecision;
import com.freelanceops.backend.domain.proposal.repository.ProposalDecisionRepository;
import com.freelanceops.backend.domain.proposal.repository.ProposalShareRepository;
import com.freelanceops.backend.domain.quotation.dto.response.QuotationItemResponse;
import com.freelanceops.backend.domain.quotation.dto.response.QuotationResponse;
import com.freelanceops.backend.domain.quotation.service.QuotationService;
import com.freelanceops.backend.domain.workspace.policy.AuthorizationDecision;
import com.freelanceops.backend.domain.workspace.policy.PermissionCode;
import com.freelanceops.backend.domain.workspace.service.WorkspaceAuthorizationService;
import org.springframework.http.HttpStatus;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.Base64;
import java.util.List;
import java.util.UUID;

@Service
public class ProposalShareService {

    private static final SecureRandom RANDOM = new SecureRandom();
    private final ProposalShareRepository shareRepository;
    private final ProjectRepository projectRepository;
    private final QuotationService quotationService;
    private final WorkspaceAuthorizationService authorizationService;
    private final ProposalDecisionRepository decisionRepository;

    public ProposalShareService(ProposalShareRepository shareRepository, ProjectRepository projectRepository, QuotationService quotationService, WorkspaceAuthorizationService authorizationService, ProposalDecisionRepository decisionRepository) {
        this.shareRepository = shareRepository;
        this.projectRepository = projectRepository;
        this.quotationService = quotationService;
        this.authorizationService = authorizationService;
        this.decisionRepository = decisionRepository;
    }

    @Transactional
    public ProposalShareCreatedResponse create(UUID userId, UUID workspaceId, UUID quotationId, int expiresInDays) {
        QuotationResponse quotation = quotationService.getPublishedForShare(userId, workspaceId, quotationId);
        Instant now = Instant.now();
        Instant requestedExpiry = now.plus(expiresInDays, ChronoUnit.DAYS);
        Instant expiresAt = requestedExpiry;
        if (quotation.validUntil() != null) {
            Instant quotationExpiry = quotation.validUntil().plusDays(1).atStartOfDay().toInstant(ZoneOffset.UTC);
            if (!quotationExpiry.isAfter(now)) {
                throw new ResponseStatusException(HttpStatus.CONFLICT, "expired quotation cannot be shared");
            }
            if (quotationExpiry.isBefore(expiresAt)) expiresAt = quotationExpiry;
        }
        String token = token();
        ProposalShareEntity share = shareRepository.save(new ProposalShareEntity(
            UUID.randomUUID(),
            workspaceId,
            quotationId,
            hash(token),
            expiresAt,
            userId,
            now
        ));
        return new ProposalShareCreatedResponse(
            share.id(),
            token,
            "/api/v2/proposals/" + token,
            share.expiresAt(),
            share.createdAt()
        );
    }

    @Transactional(readOnly = true)
    public SharedProposalResponse get(String token) {
        ProposalShareEntity share = requireAvailableShare(token);
        QuotationResponse quotation = quotationService.getPublishedInternal(share.workspaceId(), share.quotationId());
        ProjectEntity project = projectRepository.findByIdAndWorkspaceId(quotation.projectId(), share.workspaceId())
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        List<SharedProposalItemResponse> items = quotation.items().stream()
            .map(ProposalShareService::itemResponse)
            .toList();
        return new SharedProposalResponse(
            quotation.id(),
            quotation.projectId(),
            project.title(),
            quotation.versionNumber(),
            quotation.scenario(),
            quotation.currency(),
            quotation.subtotal(),
            quotation.discountTotal(),
            quotation.riskBufferAmount(),
            quotation.taxAmount(),
            quotation.total(),
            quotation.validUntil(),
            quotation.publishedAt(),
            share.expiresAt(),
            items
        );
    }

    @Transactional
    public void revoke(UUID userId, UUID workspaceId, UUID shareId) {
        authorize(userId, workspaceId, PermissionCode.QUOTATION_PUBLISH);
        ProposalShareEntity share = shareRepository.findByIdAndWorkspaceId(shareId, workspaceId)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        share.revoke(Instant.now());
    }

    @Transactional
    public ProposalDecisionResponse decide(String token, ProposalDecision decision, String clientName, String clientEmail, String comment) {
        ProposalShareEntity share = requireAvailableShareForUpdate(token);
        if (decisionRepository.existsByShareId(share.id())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "a decision was already submitted for this share");
        }
        quotationService.getPublishedInternal(share.workspaceId(), share.quotationId());
        ProposalDecisionEntity saved;
        try {
            saved = decisionRepository.saveAndFlush(new ProposalDecisionEntity(
                UUID.randomUUID(),
                share.workspaceId(),
                share.quotationId(),
                share.id(),
                decision.name(),
                trim(comment),
                clientName.trim(),
                trim(clientEmail),
                Instant.now()
            ));
        } catch (DataIntegrityViolationException error) {
            if (causedByDuplicateShareDecision(error)) {
                throw new ResponseStatusException(HttpStatus.CONFLICT, "a decision was already submitted for this share", error);
            }
            throw error;
        }
        return new ProposalDecisionResponse(
            saved.id(),
            saved.quotationId(),
            ProposalDecision.valueOf(saved.decision()),
            saved.clientName(),
            saved.comment(),
            saved.createdAt()
        );
    }

    private void authorize(UUID userId, UUID workspaceId, PermissionCode permission) {
        AuthorizationDecision decision = authorizationService.authorize(userId, workspaceId, permission);
        if (decision == AuthorizationDecision.NOT_FOUND) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        if (decision == AuthorizationDecision.FORBIDDEN) throw new ResponseStatusException(HttpStatus.FORBIDDEN);
    }

    private static SharedProposalItemResponse itemResponse(QuotationItemResponse item) {
        return new SharedProposalItemResponse(
            item.title(),
            item.description(),
            item.quantity(),
            item.unit(),
            item.unitRate(),
            item.subtotal(),
            item.discountRate(),
            item.discountAmount(),
            item.total(),
            item.basis()
        );
    }

    private ProposalShareEntity requireAvailableShare(String token) {
        if (token == null || !token.matches("^[A-Za-z0-9_-]{43}$")) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        }
        return shareRepository.findByTokenHash(hash(token))
            .filter(candidate -> candidate.availableAt(Instant.now()))
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
    }

    private ProposalShareEntity requireAvailableShareForUpdate(String token) {
        if (token == null || !token.matches("^[A-Za-z0-9_-]{43}$")) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        }
        return shareRepository.findByTokenHashForUpdate(hash(token))
            .filter(candidate -> candidate.availableAt(Instant.now()))
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
    }

    private static String trim(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    private static boolean causedByDuplicateShareDecision(Throwable error) {
        for (Throwable cause = error; cause != null; cause = cause.getCause()) {
            if (cause.getMessage() != null && cause.getMessage().contains("uq_quotation_decision_share")) {
                return true;
            }
        }
        return false;
    }

    private static String token() {
        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    static String hash(String token) {
        try {
            return java.util.HexFormat.of().formatHex(
                MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8))
            );
        } catch (NoSuchAlgorithmException error) {
            throw new IllegalStateException("SHA-256 is unavailable", error);
        }
    }
}
