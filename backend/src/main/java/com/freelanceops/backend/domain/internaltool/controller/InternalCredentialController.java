package com.freelanceops.backend.domain.internaltool.controller;

import com.freelanceops.backend.domain.agentrun.model.Provider;
import com.freelanceops.backend.domain.internaltool.security.DelegationPrincipal;
import com.freelanceops.backend.domain.internaltool.service.InternalCredentialService;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import java.util.UUID;

@RestController
@RequestMapping("/internal/v1/ai-connections")
public class InternalCredentialController {
    private final InternalCredentialService service;
    public InternalCredentialController(InternalCredentialService service) { this.service = service; }

    @GetMapping("/{id}/credential")
    public ResponseEntity<InternalCredentialService.Credential> resolve(@PathVariable UUID id, @RequestParam Provider provider, @RequestParam String model,
        @RequestAttribute("internalToolDelegationPrincipal") DelegationPrincipal principal) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.resolve(id, provider, model, principal));
    }
}
