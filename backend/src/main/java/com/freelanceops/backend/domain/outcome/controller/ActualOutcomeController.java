package com.freelanceops.backend.domain.outcome.controller;

import com.freelanceops.backend.domain.outcome.dto.request.UpsertActualOutcomeRequest;
import com.freelanceops.backend.domain.outcome.dto.response.ActualOutcomeResponse;
import com.freelanceops.backend.domain.outcome.service.ActualOutcomeService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import java.util.UUID;

@RestController
@RequestMapping("/api/v2/workspaces/{workspaceId}/projects/{projectId}/outcome")
public class ActualOutcomeController {
    private final ActualOutcomeService service;

    public ActualOutcomeController(ActualOutcomeService service) { this.service = service; }

    @GetMapping
    public ActualOutcomeResponse get(@PathVariable UUID workspaceId, @PathVariable UUID projectId, Authentication authentication) {
        return service.get(userId(authentication), workspaceId, projectId);
    }

    @PutMapping
    public ActualOutcomeResponse upsert(@PathVariable UUID workspaceId, @PathVariable UUID projectId, @Valid @RequestBody UpsertActualOutcomeRequest request, Authentication authentication) {
        return service.upsert(userId(authentication), workspaceId, projectId, request);
    }

    private static UUID userId(Authentication authentication) {
        try { return UUID.fromString(authentication.getName()); }
        catch (IllegalArgumentException error) { throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "authenticated subject must be a UUID", error); }
    }
}
