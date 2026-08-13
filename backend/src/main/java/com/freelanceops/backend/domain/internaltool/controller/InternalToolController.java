package com.freelanceops.backend.domain.internaltool.controller;

import com.freelanceops.backend.domain.internaltool.dto.request.QuoteCalculationRequest;
import com.freelanceops.backend.domain.internaltool.dto.request.RequirementDraft;
import com.freelanceops.backend.domain.internaltool.dto.response.DomainPack;
import com.freelanceops.backend.domain.internaltool.dto.response.ProjectContext;
import com.freelanceops.backend.domain.internaltool.dto.response.QuoteCalculationResult;
import com.freelanceops.backend.domain.internaltool.dto.response.RequirementValidationResult;
import com.freelanceops.backend.domain.internaltool.service.InternalToolService;
import com.freelanceops.backend.domain.agentrun.service.ToolExecutionAuditService;
import com.freelanceops.backend.domain.internaltool.security.DelegationPrincipal;
import com.freelanceops.backend.domain.internaltool.security.DelegationTokenFilter;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Size;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;
import java.util.Map;

@Validated
@RestController
@RequestMapping("/internal/v1")
public class InternalToolController {

    private final InternalToolService toolService;
    private final ToolExecutionAuditService auditService;

    public InternalToolController(InternalToolService toolService, ToolExecutionAuditService auditService) {
        this.toolService = toolService;
        this.auditService = auditService;
    }

    @GetMapping("/projects/{projectId}/context")
    public ProjectContext getProjectContext(
        @PathVariable UUID projectId,
        @RequestAttribute(DelegationTokenFilter.PRINCIPAL_ATTRIBUTE) DelegationPrincipal principal
    ) {
        return auditService.execute(
            "get_project_context", Map.of("projectId", projectId), principal.workspaceId(), principal.runId(),
            () -> toolService.getProjectContext(projectId, principal)
        );
    }

    @GetMapping("/domain-packs/{domainCode}")
    public DomainPack getDomainPack(
        @PathVariable @Size(min = 2, max = 64) String domainCode,
        @RequestAttribute(DelegationTokenFilter.PRINCIPAL_ATTRIBUTE) DelegationPrincipal principal
    ) {
        return auditService.execute(
            "get_domain_pack", Map.of("domainCode", domainCode), principal.workspaceId(), principal.runId(),
            () -> toolService.getDomainPack(domainCode, principal)
        );
    }

    @PostMapping("/requirements/validate")
    public RequirementValidationResult validateRequirements(
        @Valid @RequestBody RequirementDraft draft,
        @RequestAttribute(DelegationTokenFilter.PRINCIPAL_ATTRIBUTE) DelegationPrincipal principal
    ) {
        return auditService.execute(
            "validate_requirements", draft, principal.workspaceId(), principal.runId(),
            () -> toolService.validateRequirements(draft, principal)
        );
    }

    @PostMapping("/quotes/calculate")
    public QuoteCalculationResult calculateQuote(
        @Valid @RequestBody QuoteCalculationRequest request,
        @RequestAttribute(DelegationTokenFilter.PRINCIPAL_ATTRIBUTE) DelegationPrincipal principal
    ) {
        return auditService.execute(
            "calculate_quote", request, principal.workspaceId(), principal.runId(),
            () -> toolService.calculateQuote(request, principal)
        );
    }
}


