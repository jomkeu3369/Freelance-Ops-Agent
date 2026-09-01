package com.freelanceops.backend.domain.agenttask.controller;

import com.freelanceops.backend.domain.agenttask.dto.request.AgentTaskCancelRequest;
import com.freelanceops.backend.domain.agenttask.dto.request.AgentTaskInstructionRequest;
import com.freelanceops.backend.domain.agenttask.dto.request.AgentTaskRedirectRequest;
import com.freelanceops.backend.domain.agenttask.dto.response.AgentTaskCommandResponse;
import com.freelanceops.backend.domain.agenttask.dto.response.AgentTaskResponse;
import com.freelanceops.backend.domain.agenttask.service.AgentTaskGatewayService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/v2/workspaces/{workspaceId}/agent-runs/{runId}/tasks")
public class AgentTaskController {

    private final AgentTaskGatewayService gatewayService;

    public AgentTaskController(AgentTaskGatewayService gatewayService) {
        this.gatewayService = gatewayService;
    }

    @GetMapping
    public List<AgentTaskResponse> list(@PathVariable UUID workspaceId, @PathVariable UUID runId, Authentication authentication) {
        return gatewayService.list(authenticatedUserId(authentication), workspaceId, runId);
    }

    @GetMapping("/{taskId}")
    public AgentTaskResponse get(@PathVariable UUID workspaceId, @PathVariable UUID runId, @PathVariable UUID taskId, Authentication authentication) {
        return gatewayService.get(authenticatedUserId(authentication), workspaceId, runId, taskId);
    }

    @PostMapping("/{taskId}/instructions")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public AgentTaskCommandResponse softUpdate(@PathVariable UUID workspaceId, @PathVariable UUID runId, @PathVariable UUID taskId, @Valid @RequestBody AgentTaskInstructionRequest request, Authentication authentication) {
        return gatewayService.softUpdate(authenticatedUserId(authentication), workspaceId, runId, taskId, request);
    }

    @PostMapping("/{taskId}/redirect")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public AgentTaskCommandResponse hardRedirect(@PathVariable UUID workspaceId, @PathVariable UUID runId, @PathVariable UUID taskId, @Valid @RequestBody AgentTaskRedirectRequest request, Authentication authentication) {
        return gatewayService.hardRedirect(authenticatedUserId(authentication), workspaceId, runId, taskId, request);
    }

    @PostMapping("/{taskId}/cancel")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public AgentTaskCommandResponse cancel(@PathVariable UUID workspaceId, @PathVariable UUID runId, @PathVariable UUID taskId, @Valid @RequestBody AgentTaskCancelRequest request, Authentication authentication) {
        return gatewayService.cancel(authenticatedUserId(authentication), workspaceId, runId, taskId, request);
    }

    private static UUID authenticatedUserId(Authentication authentication) {
        try {
            return UUID.fromString(authentication.getName());
        } catch (IllegalArgumentException error) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "authenticated subject must be a UUID", error);
        }
    }
}
