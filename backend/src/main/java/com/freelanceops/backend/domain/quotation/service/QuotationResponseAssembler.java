package com.freelanceops.backend.domain.quotation.service;

import com.freelanceops.backend.domain.quotation.dto.response.QuotationBasisResponse;
import com.freelanceops.backend.domain.quotation.dto.response.QuotationItemResponse;
import com.freelanceops.backend.domain.quotation.dto.response.QuotationResponse;
import com.freelanceops.backend.domain.quotation.entity.QuotationAssumptionEntity;
import com.freelanceops.backend.domain.quotation.entity.QuotationEntity;
import com.freelanceops.backend.domain.quotation.entity.QuotationEvidenceEntity;
import com.freelanceops.backend.domain.quotation.entity.QuotationItemEntity;
import com.freelanceops.backend.domain.quotation.model.BasisType;
import com.freelanceops.backend.domain.quotation.model.EvidenceSourceType;
import com.freelanceops.backend.domain.quotation.model.QuotationScenario;
import com.freelanceops.backend.domain.quotation.model.QuotationStatus;
import com.freelanceops.backend.domain.quotation.model.WorkUnit;
import com.freelanceops.backend.domain.quotation.repository.QuotationAssumptionRepository;
import com.freelanceops.backend.domain.quotation.repository.QuotationEvidenceRepository;
import com.freelanceops.backend.domain.quotation.repository.QuotationItemRepository;

import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
public class QuotationResponseAssembler {
    private final QuotationItemRepository itemRepository;
    private final QuotationAssumptionRepository assumptionRepository;
    private final QuotationEvidenceRepository evidenceRepository;

    public QuotationResponseAssembler(
            QuotationItemRepository itemRepository,
            QuotationAssumptionRepository assumptionRepository,
            QuotationEvidenceRepository evidenceRepository) {
        this.itemRepository = itemRepository;
        this.assumptionRepository = assumptionRepository;
        this.evidenceRepository = evidenceRepository;
    }

    public List<QuotationResponse> loadAll(UUID workspaceId, List<QuotationEntity> quotations) {
        if (quotations.isEmpty()) return List.of();
        List<UUID> ids = quotations.stream().map(QuotationEntity::id).toList();
        Map<UUID, List<QuotationItemEntity>> items =
                itemRepository
                        .findAllByWorkspaceIdAndQuotationIdInOrderByQuotationIdAscSortOrderAscIdAsc(
                                workspaceId, ids)
                        .stream()
                        .collect(Collectors.groupingBy(QuotationItemEntity::quotationId));
        Map<UUID, List<QuotationAssumptionEntity>> assumptions =
                assumptionRepository.findAllByWorkspaceIdAndQuotationIdIn(workspaceId, ids).stream()
                        .collect(Collectors.groupingBy(QuotationAssumptionEntity::quotationId));
        Map<UUID, List<QuotationEvidenceEntity>> evidences =
                evidenceRepository.findAllByWorkspaceIdAndQuotationIdIn(workspaceId, ids).stream()
                        .collect(Collectors.groupingBy(QuotationEvidenceEntity::quotationId));
        return quotations.stream()
                .map(
                        quotation ->
                                assemble(
                                        quotation,
                                        items.getOrDefault(quotation.id(), List.of()),
                                        assumptions.getOrDefault(quotation.id(), List.of()),
                                        evidences.getOrDefault(quotation.id(), List.of())))
                .toList();
    }

    public QuotationResponse load(QuotationEntity quotation) {
        return assemble(
                quotation,
                itemRepository.findAllByWorkspaceIdAndQuotationIdOrderBySortOrder(
                        quotation.workspaceId(), quotation.id()),
                assumptionRepository.findAllByWorkspaceIdAndQuotationId(
                        quotation.workspaceId(), quotation.id()),
                evidenceRepository.findAllByWorkspaceIdAndQuotationId(
                        quotation.workspaceId(), quotation.id()));
    }

    public static QuotationResponse assemble(
            QuotationEntity quotation,
            List<QuotationItemEntity> items,
            List<QuotationAssumptionEntity> assumptions,
            List<QuotationEvidenceEntity> evidences) {
        Map<UUID, QuotationAssumptionEntity> assumptionById = new HashMap<>();
        assumptions.forEach(assumption -> assumptionById.put(assumption.id(), assumption));

        Map<UUID, QuotationEvidenceEntity> evidenceById = new HashMap<>();
        evidences.forEach(evidence -> evidenceById.put(evidence.id(), evidence));

        List<QuotationItemResponse> itemResponses =
                items.stream()
                        .map(
                                item ->
                                        new QuotationItemResponse(
                                                item.rateCardId(),
                                                item.title(),
                                                item.description(),
                                                item.quantity(),
                                                WorkUnit.valueOf(item.unit()),
                                                item.unitRate(),
                                                item.subtotal(),
                                                item.discountRate(),
                                                item.discountAmount(),
                                                item.total(),
                                                basisResponse(item, assumptionById, evidenceById)))
                        .toList();

        return new QuotationResponse(
                quotation.id(),
                quotation.workspaceId(),
                quotation.projectId(),
                quotation.seriesId(),
                quotation.previousVersionId(),
                quotation.versionNumber(),
                QuotationScenario.valueOf(quotation.scenario()),
                QuotationStatus.valueOf(quotation.status()),
                quotation.currency(),
                quotation.subtotal(),
                quotation.discountTotal(),
                quotation.riskBufferRate(),
                quotation.riskBufferAmount(),
                quotation.taxRate(),
                quotation.taxAmount(),
                quotation.total(),
                quotation.validUntil(),
                itemResponses,
                quotation.publishedAt(),
                quotation.createdBy(),
                quotation.createdAt(),
                quotation.version());
    }

    private static QuotationBasisResponse basisResponse(
            QuotationItemEntity item,
            Map<UUID, QuotationAssumptionEntity> assumptions,
            Map<UUID, QuotationEvidenceEntity> evidences) {
        if (item.assumptionId() != null) {
            QuotationAssumptionEntity assumption = assumptions.get(item.assumptionId());
            if (assumption == null)
                throw new IllegalStateException("quotation item assumption is missing");
            return new QuotationBasisResponse(
                    BasisType.ASSUMPTION, assumption.content(), null, null, null, null);
        }
        QuotationEvidenceEntity evidence = evidences.get(item.evidenceId());
        if (evidence == null) throw new IllegalStateException("quotation item evidence is missing");
        return new QuotationBasisResponse(
                BasisType.EVIDENCE,
                evidence.excerpt(),
                EvidenceSourceType.valueOf(evidence.sourceType()),
                evidence.sourceReference(),
                evidence.title(),
                evidence.retrievedAt());
    }
}
