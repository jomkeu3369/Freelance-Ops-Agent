package com.freelanceops.backend.domain.knowledge.controller;

import com.freelanceops.backend.domain.knowledge.dto.request.CreateRaptorIndexRequest;
import com.freelanceops.backend.domain.knowledge.dto.response.RaptorIndexResponse;
import com.freelanceops.backend.domain.knowledge.service.RaptorIndexService;
import jakarta.validation.Valid;
import org.springframework.http.*;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import java.util.UUID;
import java.util.regex.Pattern;

@RestController
@RequestMapping("/api/v2/workspaces/{workspaceId}/projects/{projectId}/knowledge/raptor-indexes")
public class RaptorIndexController {
    private static final Pattern TRACEPARENT = Pattern.compile("^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$");
    private final RaptorIndexService service;

    public RaptorIndexController(RaptorIndexService service) { this.service = service; }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public RaptorIndexResponse rebuild(@PathVariable UUID workspaceId, @PathVariable UUID projectId, @Valid @RequestBody CreateRaptorIndexRequest request, @RequestHeader(name = "traceparent", required = false) String traceparent, Authentication authentication) {
        return service.rebuild(userId(authentication), workspaceId, projectId, request, trustedTraceparent(traceparent));
    }

    private static UUID userId(Authentication authentication) {
        try { return UUID.fromString(authentication.getName()); }
        catch (IllegalArgumentException error) { throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "authenticated subject must be a UUID", error); }
    }

    private static String trustedTraceparent(String traceparent) { return traceparent == null || !TRACEPARENT.matcher(traceparent).matches() ? newTraceparent() : traceparent; }
    private static String newTraceparent() { return "00-" + UUID.randomUUID().toString().replace("-", "") + "-" + UUID.randomUUID().toString().replace("-", "").substring(0, 16) + "-01"; }
}
