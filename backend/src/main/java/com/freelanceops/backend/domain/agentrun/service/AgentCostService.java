package com.freelanceops.backend.domain.agentrun.service;

import com.freelanceops.backend.domain.agentrun.dto.request.CreateModelPricingRequest;
import com.freelanceops.backend.domain.agentrun.dto.response.AgentRunUsageResponse;
import com.freelanceops.backend.domain.agentrun.dto.response.AgentRunView;
import com.freelanceops.backend.domain.agentrun.dto.response.ModelPricingResponse;
import com.freelanceops.backend.domain.agentrun.entity.AgentRunEntity;
import com.freelanceops.backend.domain.agentrun.entity.AgentRunUsageEntity;
import com.freelanceops.backend.domain.agentrun.entity.ModelPricingEntity;
import com.freelanceops.backend.domain.agentrun.model.AgentRunStatus;
import com.freelanceops.backend.domain.agentrun.repository.AgentRunRepository;
import com.freelanceops.backend.domain.agentrun.repository.AgentRunUsageRepository;
import com.freelanceops.backend.domain.agentrun.repository.ModelPricingRepository;
import com.freelanceops.backend.domain.workspace.policy.AuthorizationDecision;
import com.freelanceops.backend.domain.workspace.policy.PermissionCode;
import com.freelanceops.backend.domain.workspace.service.WorkspaceAuthorizationService;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Service
public class AgentCostService {

    private static final BigDecimal ONE_MILLION = new BigDecimal("1000000");
    private final ModelPricingRepository pricingRepository;
    private final AgentRunUsageRepository usageRepository;
    private final AgentRunRepository runRepository;
    private final WorkspaceAuthorizationService authorizationService;

    public AgentCostService(ModelPricingRepository pricingRepository, AgentRunUsageRepository usageRepository, AgentRunRepository runRepository, WorkspaceAuthorizationService authorizationService) {
        this.pricingRepository = pricingRepository; this.usageRepository = usageRepository;
        this.runRepository = runRepository; this.authorizationService = authorizationService;
    }

    public void synchronize(AgentRunEntity run, AgentRunView view) {
        AgentRunView.AgentRunUsage usage = view.usage();
        if (usage == null) return;
        ModelPricingEntity pricing = pricingRepository.findApplicable(
            run.workspaceId(), view.metadata().provider(), view.metadata().model(), view.updatedAt()
        ).stream().findFirst().orElse(null);
        BigDecimal cost = pricing == null ? null : calculate(usage, pricing);
        AgentRunUsageEntity entity = usageRepository.findByAgentRunIdAndWorkspaceId(run.id(), run.workspaceId())
            .orElseGet(() -> new AgentRunUsageEntity(run.id(), run.workspaceId()));
        entity.update(usage, pricing, cost, view.status() == AgentRunStatus.COMPLETED, Instant.now());
        usageRepository.save(entity);
    }

    public List<ModelPricingResponse> listPricing(UUID userId, UUID workspaceId) {
        authorize(userId, workspaceId, PermissionCode.AUDIT_READ);
        return pricingRepository.findAllByWorkspaceIdOrderByValidFromDesc(workspaceId).stream()
            .map(AgentCostService::pricingResponse)
            .toList();
    }

    public ModelPricingResponse createPricing(UUID userId, UUID workspaceId, CreateModelPricingRequest request) {
        authorize(userId, workspaceId, PermissionCode.WORKSPACE_UPDATE);
        if (request.validUntil() != null && !request.validUntil().isAfter(request.validFrom())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "validUntil must be after validFrom");
        }
        ModelPricingEntity pricing = new ModelPricingEntity(
            UUID.randomUUID(), workspaceId, request.provider(), request.model().trim(), request.versionLabel().trim(),
            request.currency(), request.inputPerMillion(), request.cachedInputPerMillion(), request.outputPerMillion(),
            request.validFrom(), request.validUntil(), userId, Instant.now()
        );
        return pricingResponse(pricingRepository.save(pricing));
    }

    public AgentRunUsageResponse getUsage(UUID userId, UUID workspaceId, UUID runId) {
        authorize(userId, workspaceId, PermissionCode.AUDIT_READ);
        runRepository.findByIdAndWorkspaceId(runId, workspaceId)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        return usageRepository.findByAgentRunIdAndWorkspaceId(runId, workspaceId)
            .map(AgentCostService::usageResponse)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "run usage has not been reported"));
    }

    static BigDecimal calculate(AgentRunView.AgentRunUsage usage, ModelPricingEntity pricing) {
        long chargeableInput = usage.inputTokens() - usage.cachedTokens();
        if (chargeableInput < 0) throw new IllegalArgumentException("cached tokens exceed input tokens");
        BigDecimal input = BigDecimal.valueOf(chargeableInput).multiply(pricing.inputPerMillion());
        BigDecimal cached = BigDecimal.valueOf(usage.cachedTokens()).multiply(pricing.cachedInputPerMillion());
        BigDecimal output = BigDecimal.valueOf(usage.outputTokens()).multiply(pricing.outputPerMillion());
        return input.add(cached).add(output).divide(ONE_MILLION, 8, RoundingMode.HALF_UP);
    }

    private void authorize(UUID userId, UUID workspaceId, PermissionCode permission) {
        AuthorizationDecision decision = authorizationService.authorize(userId, workspaceId, permission);
        if (decision == AuthorizationDecision.NOT_FOUND) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        if (decision == AuthorizationDecision.FORBIDDEN) throw new ResponseStatusException(HttpStatus.FORBIDDEN);
    }

    private static ModelPricingResponse pricingResponse(ModelPricingEntity pricing) {
        return new ModelPricingResponse(
            pricing.id(), pricing.provider(), pricing.model(), pricing.versionLabel(), pricing.currency(),
            pricing.inputPerMillion(), pricing.cachedInputPerMillion(), pricing.outputPerMillion(),
            pricing.validFrom(), pricing.validUntil()
        );
    }

    private static AgentRunUsageResponse usageResponse(AgentRunUsageEntity usage) {
        return new AgentRunUsageResponse(
            usage.agentRunId(), usage.requestTier(), usage.modelCalls(), usage.toolCalls(), usage.inputTokens(),
            usage.outputTokens(), usage.cachedTokens(), usage.searchCredits(), usage.crawledPages(), usage.retryCount(),
            usage.durationMs(), usage.pricingSnapshotId(), usage.actualCost(), usage.costCurrency(), usage.costStatus(),
            usage.billableOutcome(), usage.recordedAt()
        );
    }
}
