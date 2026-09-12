package com.freelanceops.backend.domain.agentrun.controller;
import com.freelanceops.backend.domain.agentrun.service.AIConnectionService;

import com.freelanceops.backend.domain.agentrun.model.Provider;
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
    public AIConnectionController(AIConnectionService service) { this.service = service; }

    public record SaveConnection(@NotBlank @Size(max = 100) String model, @NotBlank @Size(min = 16, max = 512) String apiKey) {
        @Override public String toString() { return "SaveConnection[redacted]"; }
    }

    @GetMapping
    public ResponseEntity<AIConnectionService.Connections> list(@PathVariable UUID workspaceId, Authentication authentication) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.list(UUID.fromString(authentication.getName()), workspaceId));
    }

    @PutMapping("/{provider}")
    public ResponseEntity<AIConnectionService.Connection> save(@PathVariable UUID workspaceId, @PathVariable Provider provider, @Valid @RequestBody SaveConnection request, Authentication authentication) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.save(UUID.fromString(authentication.getName()), workspaceId, provider, request.model(), request.apiKey()));
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable UUID workspaceId, @PathVariable UUID id, Authentication authentication) {
        service.delete(UUID.fromString(authentication.getName()), workspaceId, id);
    }
}
