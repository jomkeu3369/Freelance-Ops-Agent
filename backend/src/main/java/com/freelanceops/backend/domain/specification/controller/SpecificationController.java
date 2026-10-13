package com.freelanceops.backend.domain.specification.controller;

import com.freelanceops.backend.domain.specification.dto.request.*;
import com.freelanceops.backend.domain.specification.dto.response.SpecificationResponse;
import com.freelanceops.backend.domain.specification.dto.response.SpecificationSummaryResponse;
import com.freelanceops.backend.domain.specification.service.SpecificationService;
import jakarta.validation.Valid;
import org.springframework.http.*;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/v2/workspaces/{workspaceId}/projects/{projectId}/specifications")
public class SpecificationController {
    private final SpecificationService service;
    public SpecificationController(SpecificationService service) { this.service = service; }

    @GetMapping
    public List<SpecificationSummaryResponse> list(@PathVariable UUID workspaceId, @PathVariable UUID projectId, Authentication authentication) {
        return service.list(user(authentication), workspaceId, projectId);
    }
    @GetMapping("/{id}")
    public SpecificationResponse get(@PathVariable UUID workspaceId, @PathVariable UUID projectId, @PathVariable UUID id, Authentication authentication) {
        return service.get(user(authentication), workspaceId, projectId, id);
    }
    @PostMapping
    public SpecificationResponse create(@PathVariable UUID workspaceId, @PathVariable UUID projectId,
                                        @Valid @RequestBody CreateSpecificationRequest request, Authentication authentication) {
        return service.create(user(authentication), workspaceId, projectId, request);
    }
    @PostMapping("/{id}/revisions")
    public SpecificationResponse revise(@PathVariable UUID workspaceId, @PathVariable UUID projectId, @PathVariable UUID id,
                                        @Valid @RequestBody ReviseSpecificationRequest request, Authentication authentication) {
        return service.revise(user(authentication), workspaceId, projectId, id, request);
    }
    @PostMapping("/{id}/confirm")
    public SpecificationResponse confirm(@PathVariable UUID workspaceId, @PathVariable UUID projectId, @PathVariable UUID id,
                                         @Valid @RequestBody ConfirmSpecificationRequest request, Authentication authentication) {
        return service.confirm(user(authentication), workspaceId, projectId, id, request);
    }
    @GetMapping(value = "/{id}/pdf", produces = MediaType.APPLICATION_PDF_VALUE)
    public ResponseEntity<byte[]> pdf(@PathVariable UUID workspaceId, @PathVariable UUID projectId, @PathVariable UUID id, Authentication authentication) {
        var file = service.download(user(authentication), workspaceId, projectId, id);
        return ResponseEntity.ok().contentType(MediaType.APPLICATION_PDF)
            .header(HttpHeaders.CONTENT_DISPOSITION, ContentDisposition.attachment().filename(file.fileName(), StandardCharsets.UTF_8).build().toString())
            .header(HttpHeaders.CACHE_CONTROL, "private, no-store")
            .header("X-Content-Type-Options", "nosniff")
            .header("X-Specification-Content-SHA256", file.contentHash())
            .contentLength(file.bytes().length).body(file.bytes());
    }
    private static UUID user(Authentication authentication) {
        try { return UUID.fromString(authentication.getName()); }
        catch (IllegalArgumentException exception) { throw new ResponseStatusException(HttpStatus.UNAUTHORIZED); }
    }
}
