package com.freelanceops.backend.domain.quotation.service;

import com.freelanceops.backend.domain.project.repository.ProjectRepository;
import com.freelanceops.backend.domain.quotation.dto.request.CreateQuotationRequest;
import com.freelanceops.backend.domain.quotation.dto.request.QuotationBasisRequest;
import com.freelanceops.backend.domain.quotation.dto.request.QuotationItemRequest;
import com.freelanceops.backend.domain.quotation.dto.response.QuotationBasisResponse;
import com.freelanceops.backend.domain.quotation.dto.response.QuotationItemResponse;
import com.freelanceops.backend.domain.quotation.dto.response.QuotationResponse;
import com.freelanceops.backend.domain.quotation.entity.EstimationPolicyEntity;
import com.freelanceops.backend.domain.quotation.entity.QuotationAssumptionEntity;
import com.freelanceops.backend.domain.quotation.entity.QuotationEntity;
import com.freelanceops.backend.domain.quotation.entity.QuotationEvidenceEntity;
import com.freelanceops.backend.domain.quotation.entity.QuotationItemEntity;
import com.freelanceops.backend.domain.quotation.entity.RateCardEntity;
import com.freelanceops.backend.domain.quotation.model.BasisType;
import com.freelanceops.backend.domain.quotation.model.EvidenceSourceType;
import com.freelanceops.backend.domain.quotation.model.QuotationScenario;
import com.freelanceops.backend.domain.quotation.model.QuotationStatus;
import com.freelanceops.backend.domain.quotation.model.WorkUnit;
import com.freelanceops.backend.domain.quotation.repository.EstimationPolicyRepository;
import com.freelanceops.backend.domain.quotation.repository.QuotationAssumptionRepository;
import com.freelanceops.backend.domain.quotation.repository.QuotationEvidenceRepository;
import com.freelanceops.backend.domain.quotation.repository.QuotationItemRepository;
import com.freelanceops.backend.domain.quotation.repository.QuotationRepository;
import com.freelanceops.backend.domain.quotation.repository.RateCardRepository;
import com.freelanceops.backend.domain.workspace.policy.AuthorizationDecision;
import com.freelanceops.backend.domain.workspace.policy.PermissionCode;
import com.freelanceops.backend.domain.workspace.service.WorkspaceAuthorizationService;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
public class QuotationService {
    private static final BigDecimal DEFAULT_MAXIMUM_DISCOUNT = new BigDecimal("0.300000");
    private final ProjectRepository projectRepository;
    private final QuotationRepository quotationRepository;
    private final QuotationItemRepository itemRepository;
    private final QuotationAssumptionRepository assumptionRepository;
    private final QuotationEvidenceRepository evidenceRepository;
    private final RateCardRepository rateCardRepository;
    private final EstimationPolicyRepository policyRepository;
    private final WorkspaceAuthorizationService authorizationService;
    private final QuotationCalculator calculator;

    public QuotationService(ProjectRepository projectRepository, QuotationRepository quotationRepository, QuotationItemRepository itemRepository, QuotationAssumptionRepository assumptionRepository, QuotationEvidenceRepository evidenceRepository, RateCardRepository rateCardRepository, EstimationPolicyRepository policyRepository, WorkspaceAuthorizationService authorizationService, QuotationCalculator calculator) {
        this.projectRepository = projectRepository; this.quotationRepository = quotationRepository;
        this.itemRepository = itemRepository; this.assumptionRepository = assumptionRepository;
        this.evidenceRepository = evidenceRepository; this.rateCardRepository = rateCardRepository;
        this.policyRepository = policyRepository; this.authorizationService = authorizationService;
        this.calculator = calculator;
    }

    @Transactional(readOnly = true)
    public List<QuotationResponse> list(UUID userId, UUID workspaceId, UUID projectId) {
        authorize(userId, workspaceId, PermissionCode.QUOTATION_READ);
        requireProject(workspaceId, projectId);
        return quotationRepository.findAllByWorkspaceIdAndProjectIdOrderByCreatedAtDesc(workspaceId, projectId)
            .stream().map(this::response).toList();
    }

    @Transactional(readOnly = true)
    public QuotationResponse get(UUID userId, UUID workspaceId, UUID quotationId) {
        authorize(userId, workspaceId, PermissionCode.QUOTATION_READ);
        return response(find(workspaceId, quotationId));
    }

    @Transactional
    public QuotationResponse getPublishedForShare(UUID userId, UUID workspaceId, UUID quotationId) {
        authorize(userId, workspaceId, PermissionCode.QUOTATION_PUBLISH);
        QuotationResponse quotation = publishedResponse(workspaceId, quotationId);
        requireWritableProject(workspaceId, quotation.projectId());
        return quotation;
    }

    @Transactional(readOnly = true)
    public QuotationResponse getPublishedInternal(UUID workspaceId, UUID quotationId) {
        return publishedResponse(workspaceId, quotationId);
    }

    @Transactional
    public QuotationResponse create(UUID userId, UUID workspaceId, UUID projectId, CreateQuotationRequest request) {
        authorize(userId, workspaceId, PermissionCode.QUOTATION_WRITE);
        requireWritableProject(workspaceId, projectId);
        UUID quotationId = UUID.randomUUID();
        return createVersion(userId, workspaceId, projectId, quotationId, null, quotationId, 1, request);
    }

    @Transactional
    public QuotationResponse revise(UUID userId, UUID workspaceId, UUID quotationId, CreateQuotationRequest request) {
        authorize(userId, workspaceId, PermissionCode.QUOTATION_WRITE);
        QuotationEntity source = quotationRepository.findByIdAndWorkspaceIdForUpdate(quotationId, workspaceId)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        QuotationEntity latest = quotationRepository.findTopByWorkspaceIdAndSeriesIdOrderByVersionNumberDesc(workspaceId, source.seriesId())
            .orElseThrow(() -> new IllegalStateException("quotation series has no latest version"));
        if (!latest.id().equals(source.id())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "revision must be created from the latest version");
        }
        requireWritableProject(workspaceId, source.projectId());
        return createVersion(userId, workspaceId, source.projectId(), UUID.randomUUID(), source.id(), source.seriesId(), source.versionNumber() + 1, request);
    }

    @Transactional
    public QuotationResponse publish(UUID userId, UUID workspaceId, UUID quotationId) {
        authorize(userId, workspaceId, PermissionCode.QUOTATION_PUBLISH);
        QuotationEntity quotation = quotationRepository.findByIdAndWorkspaceIdForUpdate(quotationId, workspaceId)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        QuotationEntity latest = quotationRepository.findTopByWorkspaceIdAndSeriesIdOrderByVersionNumberDesc(
            workspaceId, quotation.seriesId()
        ).orElseThrow(() -> new IllegalStateException("quotation series has no latest version"));
        if (!latest.id().equals(quotation.id())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "only the latest quotation version can be published");
        }
        requireWritableProject(workspaceId, quotation.projectId());
        try {
            quotation.publish(userId, Instant.now());
        } catch (IllegalStateException error) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, error.getMessage(), error);
        }
        return response(quotationRepository.save(quotation));
    }

    private QuotationResponse createVersion(UUID userId, UUID workspaceId, UUID projectId, UUID quotationId, UUID previousVersionId, UUID seriesId, int versionNumber, CreateQuotationRequest request) {
        Policy policy = policy(workspaceId);
        BigDecimal taxRate = request.taxRate() == null ? policy.taxRate() : request.taxRate();
        BigDecimal riskBufferRate = request.applyDefaultRiskBuffer() ? policy.riskBufferRate() : BigDecimal.ZERO;
        List<ResolvedItem> resolved = request.items().stream()
            .map(item -> resolveItem(workspaceId, request.currency(), policy.maximumDiscountRate(), item)).toList();
        QuotationCalculator.Calculation calculation = calculator.calculate(
            resolved.stream().map(item -> new QuotationCalculator.ItemInput(item.request().quantity(), item.unitRate(), item.minimumAmount(), item.request().discountRate())).toList(),
            riskBufferRate,
            taxRate
        );
        Instant now = Instant.now();
        QuotationEntity quotation = quotationRepository.saveAndFlush(new QuotationEntity(
            quotationId, workspaceId, projectId, seriesId, previousVersionId, versionNumber,
            request.scenario().name(), request.currency(), calculation.subtotal(), calculation.discountTotal(),
            calculation.riskBufferRate(), calculation.riskBufferAmount(), calculation.taxRate(),
            calculation.taxAmount(), calculation.total(), request.validUntil(), userId, now
        ));
        List<QuotationAssumptionEntity> assumptions = new ArrayList<>();
        List<QuotationEvidenceEntity> evidences = new ArrayList<>();
        List<BasisIds> basisIds = new ArrayList<>();
        for (ResolvedItem item : resolved) {
            basisIds.add(createBasis(workspaceId, quotationId, item.request().basis(), now, assumptions, evidences));
        }
        assumptionRepository.saveAll(assumptions);
        evidenceRepository.saveAll(evidences);
        List<QuotationItemEntity> items = new ArrayList<>();
        for (int index = 0; index < resolved.size(); index++) {
            ResolvedItem resolvedItem = resolved.get(index);
            QuotationCalculator.CalculatedItem amount = calculation.items().get(index);
            BasisIds basis = basisIds.get(index);
            items.add(new QuotationItemEntity(
                UUID.randomUUID(), workspaceId, quotationId, resolvedItem.rateCardId(), resolvedItem.request().title().trim(),
                trim(resolvedItem.request().description()), resolvedItem.request().quantity(), resolvedItem.unit().name(),
                resolvedItem.unitRate(), amount.subtotal(), resolvedItem.request().discountRate(), amount.discountAmount(),
                amount.total(), basis.assumptionId(), basis.evidenceId(), index, now
            ));
        }
        itemRepository.saveAll(items);
        return response(quotation, items, assumptions, evidences);
    }

    private ResolvedItem resolveItem(UUID workspaceId, String currency, BigDecimal maximumDiscountRate, QuotationItemRequest request) {
        if (request.discountRate().compareTo(maximumDiscountRate) > 0) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "discountRate exceeds workspace policy");
        }
        validateBasis(request.basis());
        if (request.rateCardId() != null) {
            RateCardEntity rateCard = rateCardRepository.findByIdAndWorkspaceId(request.rateCardId(), workspaceId)
                .filter(RateCardEntity::active)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
            if (!rateCard.currency().equals(currency)) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "rate card currency does not match quotation currency");
            }
            return new ResolvedItem(request, rateCard.id(), WorkUnit.valueOf(rateCard.unit()), rateCard.rate(), rateCard.minimumAmount());
        }
        if (request.unit() == null || request.unitRate() == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "custom item requires unit and unitRate");
        }
        return new ResolvedItem(request, null, request.unit(), request.unitRate(), BigDecimal.ZERO);
    }

    private static void validateBasis(QuotationBasisRequest basis) {
        if (basis.type() == BasisType.EVIDENCE && (basis.sourceType() == null || basis.sourceReference() == null || basis.sourceReference().isBlank())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "evidence requires sourceType and sourceReference");
        }
    }

    private static BasisIds createBasis(UUID workspaceId, UUID quotationId, QuotationBasisRequest basis, Instant now, List<QuotationAssumptionEntity> assumptions, List<QuotationEvidenceEntity> evidences) {
        UUID basisId = UUID.randomUUID();
        if (basis.type() == BasisType.ASSUMPTION) {
            assumptions.add(new QuotationAssumptionEntity(basisId, workspaceId, quotationId, basis.content().trim(), now));
            return new BasisIds(basisId, null);
        }
        evidences.add(new QuotationEvidenceEntity(
            basisId, workspaceId, quotationId, basis.sourceType().name(), basis.sourceReference().trim(),
            trim(basis.sourceTitle()), basis.content().trim(), basis.retrievedAt(), now
        ));
        return new BasisIds(null, basisId);
    }

    private Policy policy(UUID workspaceId) {
        return policyRepository.findById(workspaceId)
            .map(entity -> new Policy(entity.defaultTaxRate(), entity.defaultRiskBufferRate(), entity.maximumDiscountRate()))
            .orElse(new Policy(BigDecimal.ZERO, BigDecimal.ZERO, DEFAULT_MAXIMUM_DISCOUNT));
    }

    private void requireProject(UUID workspaceId, UUID projectId) {
        if (projectRepository.findByIdAndWorkspaceId(projectId, workspaceId).isEmpty()) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        }
    }

    private void requireWritableProject(UUID workspaceId, UUID projectId) {
        projectRepository.findByIdAndWorkspaceIdForUpdate(projectId, workspaceId)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND))
            .requireNotDeleting();
    }

    private QuotationEntity find(UUID workspaceId, UUID quotationId) {
        return quotationRepository.findByIdAndWorkspaceId(quotationId, workspaceId)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
    }

    private QuotationResponse publishedResponse(UUID workspaceId, UUID quotationId) {
        QuotationEntity quotation = find(workspaceId, quotationId);
        if (QuotationStatus.valueOf(quotation.status()) != QuotationStatus.PUBLISHED) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "only a published quotation can be shared");
        }
        return response(quotation);
    }

    private void authorize(UUID userId, UUID workspaceId, PermissionCode permission) {
        AuthorizationDecision decision = authorizationService.authorize(userId, workspaceId, permission);
        if (decision == AuthorizationDecision.NOT_FOUND) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        if (decision == AuthorizationDecision.FORBIDDEN) throw new ResponseStatusException(HttpStatus.FORBIDDEN);
    }

    private QuotationResponse response(QuotationEntity quotation) {
        return response(
            quotation,
            itemRepository.findAllByWorkspaceIdAndQuotationIdOrderBySortOrder(quotation.workspaceId(), quotation.id()),
            assumptionRepository.findAllByWorkspaceIdAndQuotationId(quotation.workspaceId(), quotation.id()),
            evidenceRepository.findAllByWorkspaceIdAndQuotationId(quotation.workspaceId(), quotation.id())
        );
    }

    private static QuotationResponse response(QuotationEntity quotation, List<QuotationItemEntity> items, List<QuotationAssumptionEntity> assumptions, List<QuotationEvidenceEntity> evidences) {
        Map<UUID, QuotationAssumptionEntity> assumptionById = new HashMap<>();
        assumptions.forEach(assumption -> assumptionById.put(assumption.id(), assumption));
        Map<UUID, QuotationEvidenceEntity> evidenceById = new HashMap<>();
        evidences.forEach(evidence -> evidenceById.put(evidence.id(), evidence));
        List<QuotationItemResponse> itemResponses = items.stream().map(item -> new QuotationItemResponse(
            item.rateCardId(), item.title(), item.description(), item.quantity(), WorkUnit.valueOf(item.unit()),
            item.unitRate(), item.subtotal(), item.discountRate(), item.discountAmount(), item.total(),
            basisResponse(item, assumptionById, evidenceById)
        )).toList();
        return new QuotationResponse(
            quotation.id(), quotation.workspaceId(), quotation.projectId(), quotation.seriesId(), quotation.previousVersionId(),
            quotation.versionNumber(), QuotationScenario.valueOf(quotation.scenario()), QuotationStatus.valueOf(quotation.status()),
            quotation.currency(), quotation.subtotal(), quotation.discountTotal(), quotation.riskBufferRate(), quotation.riskBufferAmount(),
            quotation.taxRate(), quotation.taxAmount(), quotation.total(), quotation.validUntil(), itemResponses,
            quotation.publishedAt(), quotation.createdBy(), quotation.createdAt(), quotation.version()
        );
    }

    private static QuotationBasisResponse basisResponse(QuotationItemEntity item, Map<UUID, QuotationAssumptionEntity> assumptions, Map<UUID, QuotationEvidenceEntity> evidences) {
        if (item.assumptionId() != null) {
            QuotationAssumptionEntity assumption = assumptions.get(item.assumptionId());
            if (assumption == null) throw new IllegalStateException("quotation item assumption is missing");
            return new QuotationBasisResponse(BasisType.ASSUMPTION, assumption.content(), null, null, null, null);
        }
        QuotationEvidenceEntity evidence = evidences.get(item.evidenceId());
        if (evidence == null) throw new IllegalStateException("quotation item evidence is missing");
        return new QuotationBasisResponse(BasisType.EVIDENCE, evidence.excerpt(), EvidenceSourceType.valueOf(evidence.sourceType()), evidence.sourceReference(), evidence.title(), evidence.retrievedAt());
    }

    private static String trim(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    private record Policy(BigDecimal taxRate, BigDecimal riskBufferRate, BigDecimal maximumDiscountRate) {
    }

    private record ResolvedItem(QuotationItemRequest request, UUID rateCardId, WorkUnit unit, BigDecimal unitRate, BigDecimal minimumAmount) {
    }

    private record BasisIds(UUID assumptionId, UUID evidenceId) {
    }
}
