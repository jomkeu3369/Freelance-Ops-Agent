package com.freelanceops.backend.domain.internaltool.controller;

import com.freelanceops.backend.domain.agentrun.client.PixelPetGenerationClient;
import com.freelanceops.backend.domain.agentrun.dto.response.AgentRunView.AgentRunUsage;
import com.freelanceops.backend.domain.agentrun.service.PixelPetGenerationService;
import com.freelanceops.backend.domain.internaltool.security.DelegationPrincipal;

import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.UUID;

@RestController
@RequestMapping("/internal/v1/pet-generations")
public class InternalPetUsageController {
    private final PixelPetGenerationService generation;

    public InternalPetUsageController(PixelPetGenerationService generation) {
        this.generation = generation;
    }

    @PostMapping("/{id}/usage")
    public ResponseEntity<Void> record(
            @PathVariable UUID id,
            @RequestBody AgentRunUsage usage,
            @RequestAttribute("internalToolDelegationPrincipal") DelegationPrincipal principal) {
        generation.recordUsage(id, usage, context(principal));
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).build();
    }

    @PostMapping("/{id}/complete")
    public ResponseEntity<Void> complete(
            @PathVariable UUID id,
            @RequestBody PixelPetGenerationClient.Output output,
            @RequestAttribute("internalToolDelegationPrincipal") DelegationPrincipal principal) {
        generation.complete(id, output, context(principal));
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).build();
    }

    private static PixelPetGenerationService.GenerationPrincipal context(
            DelegationPrincipal principal) {
        return new PixelPetGenerationService.GenerationPrincipal(
                principal.runId(),
                principal.workspaceId(),
                principal.projectId(),
                principal.initiatedBy(),
                principal.permissions());
    }
}
