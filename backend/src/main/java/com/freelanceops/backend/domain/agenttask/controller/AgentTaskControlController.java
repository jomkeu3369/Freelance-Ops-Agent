package com.freelanceops.backend.domain.agenttask.controller;

import com.freelanceops.backend.domain.agenttask.dto.request.AgentTaskHeartbeatRequest;
import com.freelanceops.backend.domain.agenttask.dto.request.RegisterAgentTaskRequest;
import com.freelanceops.backend.domain.agenttask.dto.response.AgentTaskResponse;
import com.freelanceops.backend.domain.agenttask.entity.AgentTaskEntity;
import com.freelanceops.backend.domain.agenttask.security.AgentTaskAuthority;
import com.freelanceops.backend.domain.agenttask.service.AgentTaskRegistry;
import com.freelanceops.backend.domain.internaltool.security.DelegationPrincipal;
import com.freelanceops.backend.domain.internaltool.security.DelegationTokenFilter;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.UUID;

@RestController
@RequestMapping("/internal/v1/agent-control")
public class AgentTaskControlController {

    private final AgentTaskRegistry registry;
    private final AgentTaskAuthority authority;

    public AgentTaskControlController(AgentTaskRegistry registry, AgentTaskAuthority authority) {
        this.registry = registry;
        this.authority = authority;
    }

    @PostMapping("/tasks")
    @ResponseStatus(HttpStatus.CREATED)
    public AgentTaskResponse register(
        @Valid @RequestBody RegisterAgentTaskRequest request,
        @RequestAttribute(DelegationTokenFilter.PRINCIPAL_ATTRIBUTE) DelegationPrincipal principal
    ) {
        authority.requireControl(principal);
        Instant now = Instant.now();
        AgentTaskEntity task = new AgentTaskEntity(request.taskId(), principal.workspaceId(), principal.runId(),
            request.parentTaskId(), request.department(), request.specialistProfile(), request.alias(),
            request.objectiveReference(), request.priority(), request.deadlineAt(), now);
        return AgentTaskResponse.from(registry.register(task, request.dependencyTaskIds(), now));
    }

    @PostMapping("/tasks/{taskId}/attempts/{attemptId}/heartbeat")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void heartbeat(
        @PathVariable UUID taskId,
        @PathVariable UUID attemptId,
        @Valid @RequestBody AgentTaskHeartbeatRequest request,
        @RequestAttribute(DelegationTokenFilter.PRINCIPAL_ATTRIBUTE) DelegationPrincipal principal
    ) {
        authority.requireControl(principal);
        registry.heartbeat(taskId, attemptId, principal.workspaceId(), request.expectedTaskRevision(),
            request.attemptNumber(), request.phase(), request.activity(), Instant.now());
    }
}
