package com.freelanceops.backend.domain.quotation.controller;

import com.freelanceops.backend.domain.quotation.dto.request.MoveRateCardRequest;
import com.freelanceops.backend.domain.quotation.dto.request.UpdateEstimationPolicyRequest;
import com.freelanceops.backend.domain.quotation.dto.request.UpsertRateCardFolderRequest;
import com.freelanceops.backend.domain.quotation.dto.request.UpsertRateCardRequest;
import com.freelanceops.backend.domain.quotation.dto.response.EstimationPolicyResponse;
import com.freelanceops.backend.domain.quotation.dto.response.RateCardFolderResponse;
import com.freelanceops.backend.domain.quotation.dto.response.RateCardResponse;
import com.freelanceops.backend.domain.quotation.service.PricingConfigurationService;
import com.freelanceops.backend.domain.quotation.service.RateCardFolderService;

import jakarta.validation.Valid;

import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/v2/workspaces/{workspaceId}")
public class PricingConfigurationController {
    private final PricingConfigurationService service;
    private final RateCardFolderService folderService;

    public PricingConfigurationController(
            PricingConfigurationService service, RateCardFolderService folderService) {
        this.service = service;
        this.folderService = folderService;
    }

    @GetMapping("/rate-cards")
    public List<RateCardResponse> listRateCards(
            @PathVariable UUID workspaceId, Authentication authentication) {
        return service.listRateCards(userId(authentication), workspaceId);
    }

    @PutMapping("/rate-cards/{rateCardId}")
    public RateCardResponse upsertRateCard(
            @PathVariable UUID workspaceId,
            @PathVariable UUID rateCardId,
            @Valid @RequestBody UpsertRateCardRequest request,
            Authentication authentication) {
        return service.upsertRateCard(userId(authentication), workspaceId, rateCardId, request);
    }

    @GetMapping("/rate-card-folders")
    public List<RateCardFolderResponse> listRateCardFolders(
            @PathVariable UUID workspaceId, Authentication authentication) {
        return folderService.listFolders(userId(authentication), workspaceId);
    }

    @PutMapping("/rate-card-folders/{folderId}")
    public RateCardFolderResponse upsertRateCardFolder(
            @PathVariable UUID workspaceId,
            @PathVariable UUID folderId,
            @Valid @RequestBody UpsertRateCardFolderRequest request,
            Authentication authentication) {
        return folderService.upsertFolder(userId(authentication), workspaceId, folderId, request);
    }

    @DeleteMapping("/rate-card-folders/{folderId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteRateCardFolder(
            @PathVariable UUID workspaceId,
            @PathVariable UUID folderId,
            Authentication authentication) {
        folderService.deleteFolder(userId(authentication), workspaceId, folderId);
    }

    @PutMapping("/rate-cards/{rateCardId}/folder")
    public RateCardResponse moveRateCard(
            @PathVariable UUID workspaceId,
            @PathVariable UUID rateCardId,
            @RequestBody MoveRateCardRequest request,
            Authentication authentication) {
        return folderService.moveRateCard(userId(authentication), workspaceId, rateCardId, request);
    }

    @GetMapping("/estimation-policy")
    public EstimationPolicyResponse getPolicy(
            @PathVariable UUID workspaceId, Authentication authentication) {
        return service.getPolicy(userId(authentication), workspaceId);
    }

    @PutMapping("/estimation-policy")
    public EstimationPolicyResponse updatePolicy(
            @PathVariable UUID workspaceId,
            @Valid @RequestBody UpdateEstimationPolicyRequest request,
            Authentication authentication) {
        return service.updatePolicy(userId(authentication), workspaceId, request);
    }

    private static UUID userId(Authentication authentication) {
        try {
            return UUID.fromString(authentication.getName());
        } catch (IllegalArgumentException error) {
            throw new ResponseStatusException(
                    HttpStatus.UNAUTHORIZED, "authenticated subject must be a UUID", error);
        }
    }
}
