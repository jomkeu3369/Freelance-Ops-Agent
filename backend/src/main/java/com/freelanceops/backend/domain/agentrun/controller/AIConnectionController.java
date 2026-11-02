package com.freelanceops.backend.domain.agentrun.controller;

import com.freelanceops.backend.domain.agentrun.dto.request.SaveAIConnectionRequest;
import com.freelanceops.backend.domain.agentrun.dto.response.AIConnectionResponse;
import com.freelanceops.backend.domain.agentrun.dto.response.AIConnectionsResponse;
import com.freelanceops.backend.domain.agentrun.model.Provider;
import com.freelanceops.backend.domain.agentrun.service.AIConnectionService;

import jakarta.validation.Valid;
import jakarta.validation.constraints.*;

import org.springframework.http.*;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.util.UUID;

@RestController
@RequestMapping("/api/v2/workspaces/{workspaceId}/ai-connections")
public class AIConnectionController {
    private final AIConnectionService service;

    public AIConnectionController(AIConnectionService service) {
        this.service = service;
    }

    @GetMapping
    public ResponseEntity<AIConnectionsResponse> list(
            @PathVariable UUID workspaceId, Authentication authentication) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(service.list(UUID.fromString(authentication.getName()), workspaceId));
    }

    @PutMapping("/{provider}")
    public ResponseEntity<AIConnectionResponse> save(
            @PathVariable UUID workspaceId,
            @PathVariable Provider provider,
            @Valid @RequestBody SaveAIConnectionRequest request,
            Authentication authentication) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(
                        service.save(
                                UUID.fromString(authentication.getName()),
                                workspaceId,
                                provider,
                                request.model(),
                                request.apiKey()));
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(
            @PathVariable UUID workspaceId, @PathVariable UUID id, Authentication authentication) {
        service.delete(UUID.fromString(authentication.getName()), workspaceId, id);
    }
}
