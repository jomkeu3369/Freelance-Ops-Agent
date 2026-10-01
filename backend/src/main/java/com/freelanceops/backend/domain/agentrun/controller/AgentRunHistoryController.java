package com.freelanceops.backend.domain.agentrun.controller;

import com.freelanceops.backend.domain.agentrun.dto.response.AgentChatTurn;
import com.freelanceops.backend.domain.agentrun.service.AgentRunHistoryService;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/v2/workspaces/{workspaceId}/projects/{projectId}/agent-runs")
public class AgentRunHistoryController {
    private final AgentRunHistoryService history;

    public AgentRunHistoryController(AgentRunHistoryService history) {
        this.history = history;
    }

    @GetMapping("/history")
    public List<AgentChatTurn> list(@PathVariable UUID workspaceId, @PathVariable UUID projectId,
                                    @RequestParam(defaultValue = "20") int limit, Authentication authentication) {
        if (authentication == null || !authentication.isAuthenticated()) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
        }
        try {
            return history.list(UUID.fromString(authentication.getName()), workspaceId, projectId, limit);
        } catch (IllegalArgumentException error) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "authenticated subject must be a UUID", error);
        }
    }
}
