package com.freelanceops.backend.domain.agentrun.controller;

import com.freelanceops.backend.domain.agentrun.dto.request.CreateModelPricingRequest;
import com.freelanceops.backend.domain.agentrun.dto.response.AgentRunUsageResponse;
import com.freelanceops.backend.domain.agentrun.dto.response.ModelPricingResponse;
import com.freelanceops.backend.domain.agentrun.service.AgentCostService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/v2/workspaces/{workspaceId}")
public class AgentCostController {
    private final AgentCostService service;

    public AgentCostController(AgentCostService service) { this.service = service; }

    @GetMapping("/model-pricing")
    public List<ModelPricingResponse> listPricing(@PathVariable UUID workspaceId, Authentication authentication) {
        return service.listPricing(userId(authentication), workspaceId);
    }

    @PostMapping("/model-pricing")
    @ResponseStatus(HttpStatus.CREATED)
    public ModelPricingResponse createPricing(@PathVariable UUID workspaceId, @Valid @RequestBody CreateModelPricingRequest request, Authentication authentication) {
        return service.createPricing(userId(authentication), workspaceId, request);
    }

    @GetMapping("/agent-runs/{runId}/usage")
    public AgentRunUsageResponse getUsage(@PathVariable UUID workspaceId, @PathVariable UUID runId, Authentication authentication) {
        return service.getUsage(userId(authentication), workspaceId, runId);
    }

    private static UUID userId(Authentication authentication) { return UUID.fromString(authentication.getName()); }
}
