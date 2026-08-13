package com.freelanceops.backend.domain.knowledge.controller;

import com.freelanceops.backend.domain.knowledge.dto.request.CreateDocumentRequest;
import com.freelanceops.backend.domain.knowledge.dto.response.DocumentResponse;
import com.freelanceops.backend.domain.knowledge.service.KnowledgeService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/v2/workspaces/{workspaceId}/documents")
public class DocumentController {
    private final KnowledgeService service;

    public DocumentController(KnowledgeService service) { this.service = service; }

    @GetMapping
    public List<DocumentResponse> list(@PathVariable UUID workspaceId, Authentication authentication) {
        return service.list(userId(authentication), workspaceId);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public DocumentResponse create(@PathVariable UUID workspaceId, @Valid @RequestBody CreateDocumentRequest request, Authentication authentication) {
        return service.create(userId(authentication), workspaceId, request);
    }

    @GetMapping("/{documentId}")
    public DocumentResponse get(@PathVariable UUID workspaceId, @PathVariable UUID documentId, Authentication authentication) {
        return service.get(userId(authentication), workspaceId, documentId);
    }

    @DeleteMapping("/{documentId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void archive(@PathVariable UUID workspaceId, @PathVariable UUID documentId, Authentication authentication) {
        service.archive(userId(authentication), workspaceId, documentId);
    }

    private static UUID userId(Authentication authentication) {
        try { return UUID.fromString(authentication.getName()); }
        catch (IllegalArgumentException error) { throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "authenticated subject must be a UUID", error); }
    }
}
