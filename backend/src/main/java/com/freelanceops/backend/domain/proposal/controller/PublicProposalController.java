package com.freelanceops.backend.domain.proposal.controller;

import com.freelanceops.backend.domain.proposal.dto.response.SharedProposalResponse;
import com.freelanceops.backend.domain.proposal.dto.request.SubmitProposalDecisionRequest;
import com.freelanceops.backend.domain.proposal.dto.response.ProposalDecisionResponse;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import com.freelanceops.backend.domain.proposal.service.ProposalShareService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;

@RestController
@RequestMapping("/api/v2/proposals")
public class PublicProposalController {

    private final ProposalShareService service;

    public PublicProposalController(ProposalShareService service) {
        this.service = service;
    }

    @GetMapping("/{token}")
    public SharedProposalResponse get(@PathVariable String token) {
        return service.get(token);
    }

    @PostMapping("/{token}/decisions")
    @ResponseStatus(HttpStatus.CREATED)
    public ProposalDecisionResponse decide(@PathVariable String token, @Valid @RequestBody SubmitProposalDecisionRequest request) {
        return service.decide(
            token,
            request.decision(),
            request.clientName(),
            request.clientEmail(),
            request.comment()
        );
    }
}
