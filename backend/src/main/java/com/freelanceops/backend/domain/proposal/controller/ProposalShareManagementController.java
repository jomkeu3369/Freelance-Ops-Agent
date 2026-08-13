package com.freelanceops.backend.domain.proposal.controller;

import com.freelanceops.backend.domain.proposal.dto.request.CreateProposalShareRequest;
import com.freelanceops.backend.domain.proposal.dto.response.ProposalShareCreatedResponse;
import com.freelanceops.backend.domain.proposal.service.ProposalShareService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.util.UUID;

@RestController
@RequestMapping("/api/v2/workspaces/{workspaceId}")
public class ProposalShareManagementController {

    private final ProposalShareService service;

    public ProposalShareManagementController(ProposalShareService service) {
        this.service = service;
    }

    @PostMapping("/quotations/{quotationId}/shares")
    @ResponseStatus(HttpStatus.CREATED)
    public ProposalShareCreatedResponse create(@PathVariable UUID workspaceId, @PathVariable UUID quotationId, @Valid @RequestBody CreateProposalShareRequest request, Authentication authentication) {
        return service.create(userId(authentication), workspaceId, quotationId, request.expiresInDays());
    }

    @DeleteMapping("/proposal-shares/{shareId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void revoke(@PathVariable UUID workspaceId, @PathVariable UUID shareId, Authentication authentication) {
        service.revoke(userId(authentication), workspaceId, shareId);
    }

    private static UUID userId(Authentication authentication) {
        try {
            return UUID.fromString(authentication.getName());
        } catch (IllegalArgumentException error) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "authenticated subject must be a UUID", error);
        }
    }
}
