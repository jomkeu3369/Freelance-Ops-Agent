package com.freelanceops.backend.domain.quotation.controller;

import com.freelanceops.backend.domain.quotation.dto.request.UpdateEstimationPolicyRequest;
import com.freelanceops.backend.domain.quotation.dto.request.UpsertRateCardRequest;
import com.freelanceops.backend.domain.quotation.dto.response.EstimationPolicyResponse;
import com.freelanceops.backend.domain.quotation.dto.response.RateCardResponse;
import com.freelanceops.backend.domain.quotation.service.PricingConfigurationService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/v2/workspaces/{workspaceId}")
public class PricingConfigurationController {
    private final PricingConfigurationService service;

    public PricingConfigurationController(PricingConfigurationService service) {
        this.service = service;
    }

    @GetMapping("/rate-cards")
    public List<RateCardResponse> listRateCards(@PathVariable UUID workspaceId, Authentication authentication) {
        return service.listRateCards(userId(authentication), workspaceId);
    }

    @PutMapping("/rate-cards/{rateCardId}")
    public RateCardResponse upsertRateCard(@PathVariable UUID workspaceId, @PathVariable UUID rateCardId, @Valid @RequestBody UpsertRateCardRequest request, Authentication authentication) {
        return service.upsertRateCard(userId(authentication), workspaceId, rateCardId, request);
    }

    @GetMapping("/estimation-policy")
    public EstimationPolicyResponse getPolicy(@PathVariable UUID workspaceId, Authentication authentication) {
        return service.getPolicy(userId(authentication), workspaceId);
    }

    @PutMapping("/estimation-policy")
    public EstimationPolicyResponse updatePolicy(@PathVariable UUID workspaceId, @Valid @RequestBody UpdateEstimationPolicyRequest request, Authentication authentication) {
        return service.updatePolicy(userId(authentication), workspaceId, request);
    }

    private static UUID userId(Authentication authentication) {
        try {
            return UUID.fromString(authentication.getName());
        } catch (IllegalArgumentException error) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "authenticated subject must be a UUID", error);
        }
    }
}
