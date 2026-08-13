package com.freelanceops.backend.internaltool.api;

import com.freelanceops.backend.internaltool.application.InternalToolService;
import com.freelanceops.backend.internaltool.security.DelegationPrincipal;
import com.freelanceops.backend.internaltool.security.DelegationTokenFilter;
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

@Validated
@RestController
@RequestMapping("/internal/v1")
public class InternalToolController {

    private final InternalToolService toolService;

    public InternalToolController(InternalToolService toolService) {
        this.toolService = toolService;
    }

    @GetMapping("/projects/{projectId}/context")
    public ToolContracts.ProjectContext getProjectContext(
        @PathVariable UUID projectId,
        @RequestAttribute(DelegationTokenFilter.PRINCIPAL_ATTRIBUTE) DelegationPrincipal principal
    ) {
        return toolService.getProjectContext(projectId, principal);
    }

    @GetMapping("/domain-packs/{domainCode}")
    public ToolContracts.DomainPack getDomainPack(
        @PathVariable @Size(min = 2, max = 64) String domainCode,
        @RequestAttribute(DelegationTokenFilter.PRINCIPAL_ATTRIBUTE) DelegationPrincipal principal
    ) {
        return toolService.getDomainPack(domainCode, principal);
    }

    @PostMapping("/requirements/validate")
    public ToolContracts.RequirementValidationResult validateRequirements(
        @Valid @RequestBody ToolContracts.RequirementDraft draft,
        @RequestAttribute(DelegationTokenFilter.PRINCIPAL_ATTRIBUTE) DelegationPrincipal principal
    ) {
        return toolService.validateRequirements(draft, principal);
    }

    @PostMapping("/quotes/calculate")
    public ToolContracts.QuoteCalculationResult calculateQuote(
        @Valid @RequestBody ToolContracts.QuoteCalculationRequest request,
        @RequestAttribute(DelegationTokenFilter.PRINCIPAL_ATTRIBUTE) DelegationPrincipal principal
    ) {
        return toolService.calculateQuote(request, principal);
    }
}
