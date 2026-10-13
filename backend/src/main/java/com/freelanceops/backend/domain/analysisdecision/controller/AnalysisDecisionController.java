package com.freelanceops.backend.domain.analysisdecision.controller;

import com.freelanceops.backend.domain.analysisdecision.dto.request.ConfirmAnalysisDecisionRequest;
import com.freelanceops.backend.domain.analysisdecision.dto.request.CreateAnalysisDecisionRequest;
import com.freelanceops.backend.domain.analysisdecision.dto.request.ReviseAnalysisDecisionRequest;
import com.freelanceops.backend.domain.analysisdecision.dto.response.AnalysisDecisionResponse;
import com.freelanceops.backend.domain.analysisdecision.dto.response.AnalysisSourceResponse;
import com.freelanceops.backend.domain.analysisdecision.service.AnalysisDecisionService;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
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

@RestController
@RequestMapping("/api/v2/workspaces/{workspaceId}/projects/{projectId}/analysis-decisions")
public class AnalysisDecisionController {
    private final AnalysisDecisionService service;
    public AnalysisDecisionController(AnalysisDecisionService service) { this.service = service; }

    @GetMapping
    public List<AnalysisDecisionResponse> list(@PathVariable UUID workspaceId, @PathVariable UUID projectId, Authentication authentication) {
        return service.list(user(authentication), workspaceId, projectId);
    }

    @GetMapping("/sources/latest")
    public ResponseEntity<AnalysisSourceResponse> source(@PathVariable UUID workspaceId, @PathVariable UUID projectId, Authentication authentication) {
        return service.latestSource(user(authentication), workspaceId, projectId).map(ResponseEntity::ok).orElseGet(() -> ResponseEntity.noContent().build());
    }

    @GetMapping("/latest-confirmed")
    public ResponseEntity<AnalysisDecisionResponse> latestConfirmed(@PathVariable UUID workspaceId, @PathVariable UUID projectId, Authentication authentication) {
        return service.getLatestConfirmed(user(authentication), workspaceId, projectId).map(ResponseEntity::ok).orElseGet(() -> ResponseEntity.noContent().build());
    }

    @GetMapping("/{decisionId}")
    public AnalysisDecisionResponse get(@PathVariable UUID workspaceId, @PathVariable UUID projectId, @PathVariable UUID decisionId, Authentication authentication) {
        return service.get(user(authentication), workspaceId, projectId, decisionId);
    }

    @GetMapping("/{decisionId}/latest-revision")
    public AnalysisDecisionResponse latestRevision(@PathVariable UUID workspaceId, @PathVariable UUID projectId, @PathVariable UUID decisionId, Authentication authentication) {
        return service.getLatestRevision(user(authentication), workspaceId, projectId, decisionId);
    }

    @PostMapping
    public AnalysisDecisionResponse create(@PathVariable UUID workspaceId, @PathVariable UUID projectId, @Valid @RequestBody CreateAnalysisDecisionRequest request, Authentication authentication) {
        return service.create(user(authentication), workspaceId, projectId, request);
    }

    @PostMapping("/{decisionId}/revisions")
    public AnalysisDecisionResponse revise(@PathVariable UUID workspaceId, @PathVariable UUID projectId, @PathVariable UUID decisionId, @Valid @RequestBody ReviseAnalysisDecisionRequest request, Authentication authentication) {
        return service.revise(user(authentication), workspaceId, projectId, decisionId, request);
    }

    @PostMapping("/{decisionId}/confirm")
    public AnalysisDecisionResponse confirm(@PathVariable UUID workspaceId, @PathVariable UUID projectId, @PathVariable UUID decisionId, @Valid @RequestBody ConfirmAnalysisDecisionRequest request, Authentication authentication) {
        return service.confirm(user(authentication), workspaceId, projectId, decisionId, request);
    }

    private static UUID user(Authentication authentication) {
        try { return UUID.fromString(authentication.getName()); }
        catch (IllegalArgumentException error) { throw new ResponseStatusException(HttpStatus.UNAUTHORIZED); }
    }
}
