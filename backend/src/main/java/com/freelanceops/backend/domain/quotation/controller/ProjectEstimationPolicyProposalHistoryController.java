package com.freelanceops.backend.domain.quotation.controller;

import com.freelanceops.backend.domain.quotation.dto.response.EstimationPolicyProposalResponse;
import com.freelanceops.backend.domain.quotation.service.EstimationPolicyProposalService;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/v2/workspaces/{workspaceId}/projects/{projectId}/estimation-policy/proposals")
public class ProjectEstimationPolicyProposalHistoryController {
    private final EstimationPolicyProposalService service;

    public ProjectEstimationPolicyProposalHistoryController(EstimationPolicyProposalService service) {
        this.service = service;
    }

    @GetMapping
    public ResponseEntity<List<EstimationPolicyProposalResponse>> recent(@PathVariable UUID workspaceId,
        @PathVariable UUID projectId, Authentication authentication) {
        if (authentication == null) throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
        UUID userId;
        try {
            userId = UUID.fromString(authentication.getName());
        } catch (IllegalArgumentException error) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "authenticated subject must be a UUID", error);
        }
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
            .body(service.listRecent(userId, workspaceId, projectId));
    }
}
