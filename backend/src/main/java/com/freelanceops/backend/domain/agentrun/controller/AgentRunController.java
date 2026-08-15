package com.freelanceops.backend.domain.agentrun.controller;

import com.freelanceops.backend.domain.agentrun.dto.response.AgentRunView;
import com.freelanceops.backend.domain.agentrun.dto.request.ResumeAgentRunRequest;
import com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest;
import com.freelanceops.backend.domain.agentrun.dto.response.StartAgentRunResponse;
import com.freelanceops.backend.domain.agentrun.service.AgentRunGatewayService;
import com.freelanceops.backend.domain.agentrun.service.AgentEventRelay;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.MediaType;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.util.UUID;
import java.util.regex.Pattern;

@RestController
@RequestMapping("/api/v2/workspaces/{workspaceId}")
public class AgentRunController {

    private static final Pattern TRACEPARENT = Pattern.compile("^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$");
    private final AgentRunGatewayService gatewayService;
    private final AgentEventRelay eventRelay;

    public AgentRunController(AgentRunGatewayService gatewayService, AgentEventRelay eventRelay) {
        this.gatewayService = gatewayService;
        this.eventRelay = eventRelay;
    }

    @PostMapping("/projects/{projectId}/agent-runs")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public StartAgentRunResponse start(
        @PathVariable UUID workspaceId,
        @PathVariable UUID projectId,
        @Valid @RequestBody StartAgentRunRequest request,
        @RequestHeader(value = "traceparent", required = false) String traceparent,
        Authentication authentication
    ) {
        UUID userId = authenticatedUserId(authentication);
        String trustedTraceparent = traceparent == null || !TRACEPARENT.matcher(traceparent).matches()
            ? newTraceparent()
            : traceparent;
        return gatewayService.start(userId, workspaceId, projectId, request, trustedTraceparent);
    }

    @GetMapping("/agent-runs/{runId}")
    public AgentRunView get(
        @PathVariable UUID workspaceId,
        @PathVariable UUID runId,
        @RequestHeader(value = "traceparent", required = false) String traceparent,
        Authentication authentication
    ) {
        return gatewayService.get(
            authenticatedUserId(authentication),
            workspaceId,
            runId,
            trustedTraceparent(traceparent)
        );
    }

    @GetMapping("/projects/{projectId}/agent-runs/latest")
    public ResponseEntity<AgentRunView> latestForProject(
        @PathVariable UUID workspaceId,
        @PathVariable UUID projectId,
        @RequestHeader(value = "traceparent", required = false) String traceparent,
        Authentication authentication
    ) {
        return gatewayService.latestForProject(
            authenticatedUserId(authentication),
            workspaceId,
            projectId,
            trustedTraceparent(traceparent)
        ).map(ResponseEntity::ok).orElseGet(() -> ResponseEntity.noContent().build());
    }

    @PostMapping("/projects/{projectId}/agent-runs/cancel-active")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void cancelActiveForProject(
        @PathVariable UUID workspaceId,
        @PathVariable UUID projectId,
        @RequestHeader(value = "traceparent", required = false) String traceparent,
        Authentication authentication
    ) {
        gatewayService.cancelActiveForProject(
            authenticatedUserId(authentication),
            workspaceId,
            projectId,
            trustedTraceparent(traceparent)
        );
    }

    @GetMapping(value = "/agent-runs/{runId}/events", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter events(
        @PathVariable UUID workspaceId,
        @PathVariable UUID runId,
        @RequestHeader(value = "Last-Event-ID", required = false) Long lastEventId,
        @RequestHeader(value = "traceparent", required = false) String traceparent,
        Authentication authentication
    ) {
        long cursor = lastEventId == null ? 0 : lastEventId;
        if (cursor < 0) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Last-Event-ID must not be negative");
        var stream = gatewayService.events(
            authenticatedUserId(authentication), workspaceId, runId, lastEventId, trustedTraceparent(traceparent)
        );
        SseEmitter emitter = new SseEmitter(0L);
        emitter.onCompletion(() -> closeQuietly(stream));
        emitter.onTimeout(() -> closeQuietly(stream));
        Thread.startVirtualThread(() -> eventRelay.relay(stream, runId, cursor, emitter));
        return emitter;
    }

    @PostMapping("/agent-runs/{runId}/responses")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public StartAgentRunResponse resume(
        @PathVariable UUID workspaceId,
        @PathVariable UUID runId,
        @Valid @RequestBody ResumeAgentRunRequest request,
        @RequestHeader(value = "traceparent", required = false) String traceparent,
        Authentication authentication
    ) {
        return gatewayService.resume(
            authenticatedUserId(authentication),
            workspaceId,
            runId,
            request,
            trustedTraceparent(traceparent)
        );
    }

    @PostMapping("/agent-runs/{runId}/cancel")
    public AgentRunView cancel(
        @PathVariable UUID workspaceId,
        @PathVariable UUID runId,
        @RequestHeader(value = "traceparent", required = false) String traceparent,
        Authentication authentication
    ) {
        return gatewayService.cancel(
            authenticatedUserId(authentication),
            workspaceId,
            runId,
            trustedTraceparent(traceparent)
        );
    }

    private static UUID authenticatedUserId(Authentication authentication) {
        try {
            return UUID.fromString(authentication.getName());
        } catch (IllegalArgumentException error) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "authenticated subject must be a UUID", error);
        }
    }

    private static String trustedTraceparent(String traceparent) {
        return traceparent == null || !TRACEPARENT.matcher(traceparent).matches() ? newTraceparent() : traceparent;
    }

    private static String newTraceparent() {
        String traceId = UUID.randomUUID().toString().replace("-", "") + UUID.randomUUID().toString().replace("-", "");
        String spanId = UUID.randomUUID().toString().replace("-", "").substring(0, 16);
        return "00-" + traceId.substring(0, 32) + "-" + spanId + "-01";
    }

    private static void closeQuietly(com.freelanceops.backend.domain.agentrun.client.AgentEventStream stream) {
        try { stream.close(); }
        catch (java.io.IOException ignored) { }
    }
}


