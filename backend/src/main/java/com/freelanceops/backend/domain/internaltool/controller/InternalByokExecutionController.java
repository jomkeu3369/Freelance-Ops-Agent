package com.freelanceops.backend.domain.internaltool.controller;

import com.freelanceops.backend.domain.agentrun.service.ByokExecutionService;
import com.freelanceops.backend.domain.internaltool.security.DelegationPrincipal;
import jakarta.validation.Valid;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.UUID;

@RestController
@RequestMapping("/internal/v1/byok-executions")
public class InternalByokExecutionController {
    private final ByokExecutionService service;
    public InternalByokExecutionController(ByokExecutionService service) { this.service = service; }
    @PostMapping("/{scopeId}/attempts")
    public ResponseEntity<ByokExecutionService.Admission> admit(@PathVariable UUID scopeId,
        @Valid @RequestBody ByokExecutionService.Attempt attempt,
        @RequestAttribute("internalToolDelegationPrincipal") DelegationPrincipal principal) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.admit(scopeId, attempt, new ByokExecutionService.ExecutionPrincipal(principal.runId(), principal.workspaceId(), principal.projectId(), principal.initiatedBy(), principal.permissions())));
    }
}
