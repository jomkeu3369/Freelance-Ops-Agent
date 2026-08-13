package com.freelanceops.backend.domain.quotation.service;

import com.freelanceops.backend.domain.quotation.dto.request.UpdateEstimationPolicyRequest;
import com.freelanceops.backend.domain.quotation.dto.request.UpsertRateCardRequest;
import com.freelanceops.backend.domain.quotation.dto.response.EstimationPolicyResponse;
import com.freelanceops.backend.domain.quotation.dto.response.RateCardResponse;
import com.freelanceops.backend.domain.quotation.entity.EstimationPolicyEntity;
import com.freelanceops.backend.domain.quotation.entity.RateCardEntity;
import com.freelanceops.backend.domain.quotation.model.WorkUnit;
import com.freelanceops.backend.domain.quotation.repository.EstimationPolicyRepository;
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
import java.util.List;
import java.util.UUID;

@Service
public class PricingConfigurationService {
    private static final BigDecimal DEFAULT_MAXIMUM_DISCOUNT = new BigDecimal("0.300000");
    private final RateCardRepository rateCardRepository;
    private final EstimationPolicyRepository policyRepository;
    private final WorkspaceAuthorizationService authorizationService;

    public PricingConfigurationService(RateCardRepository rateCardRepository, EstimationPolicyRepository policyRepository, WorkspaceAuthorizationService authorizationService) {
        this.rateCardRepository = rateCardRepository; this.policyRepository = policyRepository;
        this.authorizationService = authorizationService;
    }

    @Transactional(readOnly = true)
    public List<RateCardResponse> listRateCards(UUID userId, UUID workspaceId) {
        authorize(userId, workspaceId, PermissionCode.QUOTATION_READ);
        return rateCardRepository.findAllByWorkspaceIdOrderByName(workspaceId).stream().map(PricingConfigurationService::response).toList();
    }

    @Transactional
    public RateCardResponse upsertRateCard(UUID userId, UUID workspaceId, UUID rateCardId, UpsertRateCardRequest request) {
        authorize(userId, workspaceId, PermissionCode.QUOTATION_WRITE);
        Instant now = Instant.now();
        RateCardEntity entity = rateCardRepository.findByIdAndWorkspaceId(rateCardId, workspaceId)
            .orElseGet(() -> new RateCardEntity(rateCardId, workspaceId, request.name().trim(), request.unit().name(), request.rate(), request.minimumAmount(), request.currency(), userId, now));
        entity.update(request.name().trim(), request.unit().name(), request.rate(), request.minimumAmount(), request.currency(), request.active(), now);
        return response(rateCardRepository.save(entity));
    }

    @Transactional(readOnly = true)
    public EstimationPolicyResponse getPolicy(UUID userId, UUID workspaceId) {
        authorize(userId, workspaceId, PermissionCode.QUOTATION_READ);
        return policyRepository.findById(workspaceId).map(PricingConfigurationService::response)
            .orElse(new EstimationPolicyResponse(workspaceId, BigDecimal.ZERO, BigDecimal.ZERO, DEFAULT_MAXIMUM_DISCOUNT, 0));
    }

    @Transactional
    public EstimationPolicyResponse updatePolicy(UUID userId, UUID workspaceId, UpdateEstimationPolicyRequest request) {
        authorize(userId, workspaceId, PermissionCode.QUOTATION_WRITE);
        Instant now = Instant.now();
        EstimationPolicyEntity entity = policyRepository.findById(workspaceId)
            .orElseGet(() -> new EstimationPolicyEntity(workspaceId, request.defaultTaxRate(), request.defaultRiskBufferRate(), request.maximumDiscountRate(), userId, now));
        entity.update(request.defaultTaxRate(), request.defaultRiskBufferRate(), request.maximumDiscountRate(), now);
        return response(policyRepository.save(entity));
    }

    private void authorize(UUID userId, UUID workspaceId, PermissionCode permission) {
        AuthorizationDecision decision = authorizationService.authorize(userId, workspaceId, permission);
        if (decision == AuthorizationDecision.NOT_FOUND) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        if (decision == AuthorizationDecision.FORBIDDEN) throw new ResponseStatusException(HttpStatus.FORBIDDEN);
    }

    private static RateCardResponse response(RateCardEntity entity) {
        return new RateCardResponse(entity.id(), entity.workspaceId(), entity.name(), WorkUnit.valueOf(entity.unit()), entity.rate(), entity.minimumAmount(), entity.currency(), entity.active(), entity.version());
    }

    private static EstimationPolicyResponse response(EstimationPolicyEntity entity) {
        return new EstimationPolicyResponse(entity.workspaceId(), entity.defaultTaxRate(), entity.defaultRiskBufferRate(), entity.maximumDiscountRate(), entity.version());
    }
}
