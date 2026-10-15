package com.freelanceops.backend.domain.quotation.service;

import com.freelanceops.backend.domain.project.repository.ProjectRepository;
import com.freelanceops.backend.domain.quotation.dto.request.CreateQuotationRequest;
import com.freelanceops.backend.domain.quotation.dto.request.QuotationBasisRequest;
import com.freelanceops.backend.domain.quotation.dto.response.QuotationPageResponse;
import com.freelanceops.backend.domain.quotation.dto.response.QuotationResponse;
import com.freelanceops.backend.domain.quotation.entity.QuotationAssumptionEntity;
import com.freelanceops.backend.domain.quotation.entity.QuotationEntity;
import com.freelanceops.backend.domain.quotation.entity.QuotationEvidenceEntity;
import com.freelanceops.backend.domain.quotation.entity.QuotationItemEntity;
import com.freelanceops.backend.domain.quotation.model.BasisType;
import com.freelanceops.backend.domain.quotation.model.QuotationStatus;
import com.freelanceops.backend.domain.quotation.repository.QuotationAssumptionRepository;
import com.freelanceops.backend.domain.quotation.repository.QuotationEvidenceRepository;
import com.freelanceops.backend.domain.quotation.repository.QuotationItemRepository;
import com.freelanceops.backend.domain.quotation.repository.QuotationRepository;
import com.freelanceops.backend.domain.quotation.service.QuotationCalculationService.PreparedCalculation;
import com.freelanceops.backend.domain.quotation.service.QuotationCalculationService.ResolvedItem;
import com.freelanceops.backend.domain.workspace.policy.AuthorizationDecision;
import com.freelanceops.backend.domain.workspace.policy.PermissionCode;
import com.freelanceops.backend.domain.workspace.service.WorkspaceAuthorizationService;

import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Service
public class QuotationService {
    public static final int MAX_LIST_PAGE_SIZE = 100;
    private final ProjectRepository projectRepository;
    private final QuotationRepository quotationRepository;
    private final QuotationItemRepository itemRepository;
    private final QuotationAssumptionRepository assumptionRepository;
    private final QuotationEvidenceRepository evidenceRepository;
    private final WorkspaceAuthorizationService authorizationService;
    private final QuotationCalculationService calculations;
    private final QuotationResponseAssembler assembler;

    public QuotationService(
            ProjectRepository projectRepository,
            QuotationRepository quotationRepository,
            QuotationItemRepository itemRepository,
            QuotationAssumptionRepository assumptionRepository,
            QuotationEvidenceRepository evidenceRepository,
            WorkspaceAuthorizationService authorizationService,
            QuotationCalculationService calculations,
            QuotationResponseAssembler assembler) {
        this.projectRepository = projectRepository;
        this.quotationRepository = quotationRepository;
        this.itemRepository = itemRepository;
        this.assumptionRepository = assumptionRepository;
        this.evidenceRepository = evidenceRepository;
        this.authorizationService = authorizationService;
        this.calculations = calculations;
        this.assembler = assembler;
    }

    @Transactional(readOnly = true)
    public List<QuotationResponse> list(UUID userId, UUID workspaceId, UUID projectId) {
        authorize(userId, workspaceId, PermissionCode.QUOTATION_READ);
        requireProject(workspaceId, projectId);
        // 기존 API는 전체 목록을 반환하되 하위 조회를 나눠 실행한다. 화면의 이력 조회에는 listPage를 사용한다.
        List<QuotationEntity> quotations =
                quotationRepository.findAllByWorkspaceIdAndProjectIdOrderByCreatedAtDescIdDesc(
                        workspaceId, projectId);
        List<QuotationResponse> responses = new ArrayList<>(quotations.size());
        for (int start = 0; start < quotations.size(); start += MAX_LIST_PAGE_SIZE) {
            responses.addAll(
                    assembler.loadAll(
                            workspaceId,
                            quotations.subList(
                                    start,
                                    Math.min(start + MAX_LIST_PAGE_SIZE, quotations.size()))));
        }
        return List.copyOf(responses);
    }

    @Transactional(readOnly = true)
    public QuotationPageResponse listPage(
            UUID userId, UUID workspaceId, UUID projectId, int limit, String cursor) {
        authorize(userId, workspaceId, PermissionCode.QUOTATION_READ);
        requireProject(workspaceId, projectId);
        if (limit < 1 || limit > MAX_LIST_PAGE_SIZE) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST, "limit must be between 1 and 100");
        }
        QuotationCursor boundary = QuotationCursor.decode(cursor);
        PageRequest window = PageRequest.of(0, limit + 1);
        List<QuotationEntity> fetched =
                boundary == null
                        ? quotationRepository.findFirstPage(workspaceId, projectId, window)
                        : quotationRepository.findNextPage(
                                workspaceId,
                                projectId,
                                boundary.createdAt(),
                                boundary.id(),
                                window);
        boolean hasNext = fetched.size() > limit;
        List<QuotationEntity> page = hasNext ? fetched.subList(0, limit) : fetched;
        return new QuotationPageResponse(
                assembler.loadAll(workspaceId, page),
                hasNext ? QuotationCursor.encode(page.getLast()) : null);
    }

    @Transactional(readOnly = true)
    public QuotationResponse getLatest(UUID userId, UUID workspaceId, UUID quotationId) {
        authorize(userId, workspaceId, PermissionCode.QUOTATION_READ);
        QuotationEntity source = find(workspaceId, quotationId);
        QuotationEntity latest =
                quotationRepository
                        .findTopByWorkspaceIdAndSeriesIdOrderByVersionNumberDesc(
                                workspaceId, source.seriesId())
                        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        return assembler.load(latest);
    }

    @Transactional(readOnly = true)
    public QuotationResponse get(UUID userId, UUID workspaceId, UUID quotationId) {
        authorize(userId, workspaceId, PermissionCode.QUOTATION_READ);
        return assembler.load(find(workspaceId, quotationId));
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
    public QuotationResponse create(
            UUID userId, UUID workspaceId, UUID projectId, CreateQuotationRequest request) {
        authorize(userId, workspaceId, PermissionCode.QUOTATION_WRITE);
        requireWritableProject(workspaceId, projectId);
        UUID quotationId = UUID.randomUUID();
        return createVersion(
                userId, workspaceId, projectId, quotationId, null, quotationId, 1, request);
    }

    @Transactional(readOnly = true)
    public QuotationCalculator.Calculation preview(
            UUID userId, UUID workspaceId, UUID projectId, CreateQuotationRequest request) {
        authorize(userId, workspaceId, PermissionCode.QUOTATION_READ);
        authorize(userId, workspaceId, PermissionCode.QUOTATION_WRITE);
        projectRepository
                .findByIdAndWorkspaceId(projectId, workspaceId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND))
                .requireNotDeleting();
        return calculations.prepare(workspaceId, request).calculation();
    }

    @Transactional
    public QuotationResponse revise(
            UUID userId, UUID workspaceId, UUID quotationId, CreateQuotationRequest request) {
        authorize(userId, workspaceId, PermissionCode.QUOTATION_WRITE);
        QuotationEntity source =
                quotationRepository
                        .findByIdAndWorkspaceIdForUpdate(quotationId, workspaceId)
                        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        QuotationEntity latest =
                quotationRepository
                        .findTopByWorkspaceIdAndSeriesIdOrderByVersionNumberDesc(
                                workspaceId, source.seriesId())
                        .orElseThrow(
                                () ->
                                        new IllegalStateException(
                                                "quotation series has no latest version"));
        if (!latest.id().equals(source.id())) {
            throw new ResponseStatusException(
                    HttpStatus.CONFLICT, "revision must be created from the latest version");
        }
        requireWritableProject(workspaceId, source.projectId());
        return createVersion(
                userId,
                workspaceId,
                source.projectId(),
                UUID.randomUUID(),
                source.id(),
                source.seriesId(),
                source.versionNumber() + 1,
                request);
    }

    @Transactional
    public QuotationResponse publish(UUID userId, UUID workspaceId, UUID quotationId) {
        authorize(userId, workspaceId, PermissionCode.QUOTATION_PUBLISH);
        QuotationEntity quotation =
                quotationRepository
                        .findByIdAndWorkspaceIdForUpdate(quotationId, workspaceId)
                        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        QuotationEntity latest =
                quotationRepository
                        .findTopByWorkspaceIdAndSeriesIdOrderByVersionNumberDesc(
                                workspaceId, quotation.seriesId())
                        .orElseThrow(
                                () ->
                                        new IllegalStateException(
                                                "quotation series has no latest version"));
        if (!latest.id().equals(quotation.id())) {
            throw new ResponseStatusException(
                    HttpStatus.CONFLICT, "only the latest quotation version can be published");
        }
        requireWritableProject(workspaceId, quotation.projectId());
        try {
            quotation.publish(userId, Instant.now());
        } catch (IllegalStateException error) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, error.getMessage(), error);
        }
        return assembler.load(quotationRepository.save(quotation));
    }

    private QuotationResponse createVersion(
            UUID userId,
            UUID workspaceId,
            UUID projectId,
            UUID quotationId,
            UUID previousVersionId,
            UUID seriesId,
            int versionNumber,
            CreateQuotationRequest request) {
        PreparedCalculation prepared = calculations.prepare(workspaceId, request);
        List<ResolvedItem> resolved = prepared.items();
        QuotationCalculator.Calculation calculation = prepared.calculation();
        return persistVersion(
                userId,
                workspaceId,
                projectId,
                quotationId,
                previousVersionId,
                seriesId,
                versionNumber,
                request,
                resolved,
                calculation);
    }

    private QuotationResponse persistVersion(
            UUID userId,
            UUID workspaceId,
            UUID projectId,
            UUID quotationId,
            UUID previousVersionId,
            UUID seriesId,
            int versionNumber,
            CreateQuotationRequest request,
            List<ResolvedItem> resolved,
            QuotationCalculator.Calculation calculation) {
        Instant now = Instant.now();
        QuotationEntity quotation =
                quotationRepository.saveAndFlush(
                        new QuotationEntity(
                                quotationId,
                                workspaceId,
                                projectId,
                                seriesId,
                                previousVersionId,
                                versionNumber,
                                request.scenario().name(),
                                request.currency(),
                                calculation.subtotal(),
                                calculation.discountTotal(),
                                calculation.riskBufferRate(),
                                calculation.riskBufferAmount(),
                                calculation.taxRate(),
                                calculation.taxAmount(),
                                calculation.total(),
                                request.validUntil(),
                                userId,
                                now));
        List<QuotationAssumptionEntity> assumptions = new ArrayList<>();
        List<QuotationEvidenceEntity> evidences = new ArrayList<>();
        List<BasisIds> basisIds = new ArrayList<>();
        for (ResolvedItem item : resolved) {
            basisIds.add(
                    createBasis(
                            workspaceId,
                            quotationId,
                            item.request().basis(),
                            now,
                            assumptions,
                            evidences));
        }
        assumptionRepository.saveAll(assumptions);
        evidenceRepository.saveAll(evidences);
        List<QuotationItemEntity> items = new ArrayList<>();
        for (int index = 0; index < resolved.size(); index++) {
            ResolvedItem resolvedItem = resolved.get(index);
            QuotationCalculator.CalculatedItem amount = calculation.items().get(index);
            BasisIds basis = basisIds.get(index);
            items.add(
                    new QuotationItemEntity(
                            UUID.randomUUID(),
                            workspaceId,
                            quotationId,
                            resolvedItem.rateCardId(),
                            resolvedItem.request().title().trim(),
                            trim(resolvedItem.request().description()),
                            resolvedItem.request().quantity(),
                            resolvedItem.unit().name(),
                            resolvedItem.unitRate(),
                            amount.subtotal(),
                            resolvedItem.request().discountRate(),
                            amount.discountAmount(),
                            amount.total(),
                            basis.assumptionId(),
                            basis.evidenceId(),
                            index,
                            now));
        }
        itemRepository.saveAll(items);
        return QuotationResponseAssembler.assemble(quotation, items, assumptions, evidences);
    }

    private static BasisIds createBasis(
            UUID workspaceId,
            UUID quotationId,
            QuotationBasisRequest basis,
            Instant now,
            List<QuotationAssumptionEntity> assumptions,
            List<QuotationEvidenceEntity> evidences) {
        UUID basisId = UUID.randomUUID();
        if (basis.type() == BasisType.ASSUMPTION) {
            assumptions.add(
                    new QuotationAssumptionEntity(
                            basisId, workspaceId, quotationId, basis.content().trim(), now));
            return new BasisIds(basisId, null);
        }
        evidences.add(
                new QuotationEvidenceEntity(
                        basisId,
                        workspaceId,
                        quotationId,
                        basis.sourceType().name(),
                        basis.sourceReference().trim(),
                        trim(basis.sourceTitle()),
                        basis.content().trim(),
                        basis.retrievedAt(),
                        now));
        return new BasisIds(null, basisId);
    }

    private void requireProject(UUID workspaceId, UUID projectId) {
        if (projectRepository.findByIdAndWorkspaceId(projectId, workspaceId).isEmpty()) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        }
    }

    private void requireWritableProject(UUID workspaceId, UUID projectId) {
        projectRepository
                .findByIdAndWorkspaceIdForUpdate(projectId, workspaceId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND))
                .requireNotDeleting();
    }

    private QuotationEntity find(UUID workspaceId, UUID quotationId) {
        return quotationRepository
                .findByIdAndWorkspaceId(quotationId, workspaceId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
    }

    private QuotationResponse publishedResponse(UUID workspaceId, UUID quotationId) {
        QuotationEntity quotation = find(workspaceId, quotationId);
        if (QuotationStatus.valueOf(quotation.status()) != QuotationStatus.PUBLISHED) {
            throw new ResponseStatusException(
                    HttpStatus.CONFLICT, "only a published quotation can be shared");
        }
        return assembler.load(quotation);
    }

    private void authorize(UUID userId, UUID workspaceId, PermissionCode permission) {
        AuthorizationDecision decision =
                authorizationService.authorize(userId, workspaceId, permission);
        if (decision == AuthorizationDecision.NOT_FOUND)
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        if (decision == AuthorizationDecision.FORBIDDEN)
            throw new ResponseStatusException(HttpStatus.FORBIDDEN);
    }

    private static String trim(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    private record BasisIds(UUID assumptionId, UUID evidenceId) {}
}
