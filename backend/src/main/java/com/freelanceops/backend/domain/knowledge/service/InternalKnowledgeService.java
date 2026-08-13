package com.freelanceops.backend.domain.knowledge.service;

import com.freelanceops.backend.domain.internaltool.security.DelegationPrincipal;
import com.freelanceops.backend.domain.internaltool.service.ToolAccessException;
import com.freelanceops.backend.domain.knowledge.dto.request.KnowledgeSearchRequest;
import com.freelanceops.backend.domain.knowledge.dto.response.KnowledgeSearchResult;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import java.util.List;

@Service
public class InternalKnowledgeService {
    private final KnowledgeService knowledgeService;

    public InternalKnowledgeService(KnowledgeService knowledgeService) { this.knowledgeService = knowledgeService; }

    public List<KnowledgeSearchResult> search(KnowledgeSearchRequest request, DelegationPrincipal principal) {
        if (!principal.permissions().contains("agent.run") || !principal.permissions().contains("document.read")) {
            throw new ToolAccessException(HttpStatus.FORBIDDEN, "TOOL_PERMISSION_REQUIRED");
        }
        return knowledgeService.search(principal.initiatedBy(), principal.workspaceId(), request);
    }
}
