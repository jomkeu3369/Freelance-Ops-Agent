package com.freelanceops.backend.domain.quotation.service;

import com.freelanceops.backend.domain.quotation.dto.request.CreateQuotationRequest;
import com.freelanceops.backend.domain.quotation.dto.request.QuotationBasisRequest;
import com.freelanceops.backend.domain.quotation.dto.request.QuotationItemRequest;
import com.freelanceops.backend.domain.quotation.entity.RateCardEntity;
import com.freelanceops.backend.domain.quotation.model.BasisType;
import com.freelanceops.backend.domain.quotation.model.WorkUnit;
import com.freelanceops.backend.domain.quotation.repository.EstimationPolicyRepository;
import com.freelanceops.backend.domain.quotation.repository.RateCardRepository;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

@Service
public class QuotationCalculationService {
    private static final BigDecimal DEFAULT_MAXIMUM_DISCOUNT = new BigDecimal("0.300000");
    private final RateCardRepository rateCardRepository;
    private final EstimationPolicyRepository policyRepository;
    private final QuotationCalculator calculator;

    public QuotationCalculationService(
            RateCardRepository rateCardRepository,
            EstimationPolicyRepository policyRepository,
            QuotationCalculator calculator) {
        this.rateCardRepository = rateCardRepository;
        this.policyRepository = policyRepository;
        this.calculator = calculator;
    }

    public PreparedCalculation prepare(UUID workspaceId, CreateQuotationRequest request) {
        Policy policy = policy(workspaceId);
        BigDecimal taxRate = request.taxRate() == null ? policy.taxRate() : request.taxRate();
        BigDecimal riskBufferRate =
                request.applyDefaultRiskBuffer() ? policy.riskBufferRate() : BigDecimal.ZERO;
        List<ResolvedItem> resolved =
                request.items().stream()
                        .map(
                                item ->
                                        resolveItem(
                                                workspaceId,
                                                request.currency(),
                                                policy.maximumDiscountRate(),
                                                item))
                        .toList();
        QuotationCalculator.Calculation calculation =
                calculator.calculate(
                        resolved.stream()
                                .map(
                                        item ->
                                                new QuotationCalculator.ItemInput(
                                                        item.request().quantity(),
                                                        item.unitRate(),
                                                        item.minimumAmount(),
                                                        item.request().discountRate()))
                                .toList(),
                        riskBufferRate,
                        taxRate);
        return new PreparedCalculation(resolved, calculation);
    }

    private ResolvedItem resolveItem(
            UUID workspaceId,
            String currency,
            BigDecimal maximumDiscountRate,
            QuotationItemRequest request) {
        if (request.discountRate().compareTo(maximumDiscountRate) > 0) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST, "discountRate exceeds workspace policy");
        }
        validateBasis(request.basis());
        if (request.rateCardId() != null) {
            RateCardEntity rateCard =
                    rateCardRepository
                            .findByIdAndWorkspaceId(request.rateCardId(), workspaceId)
                            .filter(RateCardEntity::active)
                            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
            if (!rateCard.currency().equals(currency)) {
                throw new ResponseStatusException(
                        HttpStatus.BAD_REQUEST,
                        "rate card currency does not match quotation currency");
            }
            return new ResolvedItem(
                    request,
                    rateCard.id(),
                    WorkUnit.valueOf(rateCard.unit()),
                    rateCard.rate(),
                    rateCard.minimumAmount());
        }
        if (request.unit() == null || request.unitRate() == null) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST, "custom item requires unit and unitRate");
        }
        return new ResolvedItem(request, null, request.unit(), request.unitRate(), BigDecimal.ZERO);
    }

    private static void validateBasis(QuotationBasisRequest basis) {
        if (basis.type() == BasisType.EVIDENCE
                && (basis.sourceType() == null
                        || basis.sourceReference() == null
                        || basis.sourceReference().isBlank())) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST, "evidence requires sourceType and sourceReference");
        }
    }

    private Policy policy(UUID workspaceId) {
        return policyRepository
                .findById(workspaceId)
                .map(
                        entity ->
                                new Policy(
                                        entity.defaultTaxRate(),
                                        entity.defaultRiskBufferRate(),
                                        entity.maximumDiscountRate()))
                .orElse(new Policy(BigDecimal.ZERO, BigDecimal.ZERO, DEFAULT_MAXIMUM_DISCOUNT));
    }

    private record Policy(
            BigDecimal taxRate, BigDecimal riskBufferRate, BigDecimal maximumDiscountRate) {}

    public record ResolvedItem(
            QuotationItemRequest request,
            UUID rateCardId,
            WorkUnit unit,
            BigDecimal unitRate,
            BigDecimal minimumAmount) {}

    public record PreparedCalculation(
            List<ResolvedItem> items, QuotationCalculator.Calculation calculation) {}
}
