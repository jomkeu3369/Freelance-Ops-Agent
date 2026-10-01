package com.freelanceops.backend.domain.quotation.controller;

import com.freelanceops.backend.domain.quotation.dto.request.ConfirmEstimationPolicyProposalRequest;
import com.freelanceops.backend.domain.quotation.dto.request.ProposeEstimationPolicyRequest;
import com.freelanceops.backend.domain.quotation.dto.response.EstimationPolicyProposalResponse;
import com.freelanceops.backend.domain.quotation.service.EstimationPolicyProposalService;
import jakarta.validation.Valid;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import java.util.UUID;

@RestController
@RequestMapping("/api/v2/workspaces/{workspaceId}/estimation-policy/proposals")
public class EstimationPolicyProposalController {
    private final EstimationPolicyProposalService service;

    public EstimationPolicyProposalController(EstimationPolicyProposalService service) {
        this.service = service;
    }

    @PostMapping
    public EstimationPolicyProposalResponse propose(@PathVariable UUID workspaceId,
        @Valid @RequestBody ProposeEstimationPolicyRequest request, Authentication authentication) {
        return service.propose(userId(authentication), workspaceId, request);
    }

    @GetMapping("/{proposalId}")
    public ResponseEntity<EstimationPolicyProposalResponse> get(@PathVariable UUID workspaceId, @PathVariable UUID proposalId,
        Authentication authentication) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
            .body(service.get(userId(authentication), workspaceId, proposalId));
    }

    @PostMapping("/{proposalId}/confirm")
    public EstimationPolicyProposalResponse confirm(@PathVariable UUID workspaceId, @PathVariable UUID proposalId,
        @Valid @RequestBody ConfirmEstimationPolicyProposalRequest request, Authentication authentication) {
        return service.confirm(userId(authentication), workspaceId, proposalId, request);
    }

    private static UUID userId(Authentication authentication) {
        if (authentication == null) throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
        try {
            return UUID.fromString(authentication.getName());
        } catch (IllegalArgumentException error) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "authenticated subject must be a UUID", error);
        }
    }
}
