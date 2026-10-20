package com.freelanceops.backend.domain.agentrun.controller;

import com.freelanceops.backend.domain.agentrun.service.PixelPetGenerationService;

import jakarta.validation.Valid;

import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.util.UUID;

@RestController
@RequestMapping("/api/v2/workspaces/{workspaceId}/agent-pets/generations")
public class PixelPetGenerationController {
    private final PixelPetGenerationService generation;

    public PixelPetGenerationController(PixelPetGenerationService generation) {
        this.generation = generation;
    }

    @PostMapping
    public ResponseEntity<PixelPetGenerationService.Generation> generate(
            @PathVariable UUID workspaceId,
            Authentication auth,
            @Valid @RequestBody PixelPetGenerationService.Generate request) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(generation.generate(UUID.fromString(auth.getName()), workspaceId, request));
    }

    @GetMapping("/{generationId}")
    public ResponseEntity<PixelPetGenerationService.Generation> get(
            @PathVariable UUID workspaceId, @PathVariable UUID generationId, Authentication auth) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(generation.get(UUID.fromString(auth.getName()), workspaceId, generationId));
    }
}
