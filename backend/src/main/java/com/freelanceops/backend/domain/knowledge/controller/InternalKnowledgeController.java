package com.freelanceops.backend.domain.knowledge.controller;

import com.freelanceops.backend.domain.internaltool.security.DelegationPrincipal;
import com.freelanceops.backend.domain.internaltool.security.DelegationTokenFilter;
import com.freelanceops.backend.domain.knowledge.dto.request.KnowledgeSearchRequest;
import com.freelanceops.backend.domain.knowledge.dto.response.KnowledgeSearchResult;
import com.freelanceops.backend.domain.knowledge.service.InternalKnowledgeService;
import com.freelanceops.backend.domain.agentrun.service.ToolExecutionAuditService;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import java.util.List;

@RestController
@RequestMapping("/internal/v1/knowledge")
public class InternalKnowledgeController {
    private final InternalKnowledgeService service;
    private final ToolExecutionAuditService auditService;

    public InternalKnowledgeController(InternalKnowledgeService service, ToolExecutionAuditService auditService) {
        this.service = service;
        this.auditService = auditService;
    }

    @PostMapping("/search")
    public List<KnowledgeSearchResult> search(@Valid @RequestBody KnowledgeSearchRequest request, @RequestAttribute(DelegationTokenFilter.PRINCIPAL_ATTRIBUTE) DelegationPrincipal principal) {
        return auditService.execute(
            "search_knowledge", request, principal.workspaceId(), principal.runId(),
            () -> service.search(request, principal)
        );
    }
}
