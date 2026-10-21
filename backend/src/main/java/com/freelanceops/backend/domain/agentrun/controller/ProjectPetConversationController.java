package com.freelanceops.backend.domain.agentrun.controller;

import com.freelanceops.backend.domain.agentrun.service.*;
import jakarta.validation.Valid;
import org.springframework.http.*;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import java.util.UUID;

@RestController
@RequestMapping("/api/v2/workspaces/{workspaceId}/projects/{projectId}/pet-conversation")
public class ProjectPetConversationController {
    private final ProjectPetConversationService conversations;
    private final PetConversationDraftService drafts;
    public ProjectPetConversationController(ProjectPetConversationService conversations, PetConversationDraftService drafts) {
        this.conversations = conversations; this.drafts = drafts;
    }
    @GetMapping
    public ResponseEntity<ProjectPetConversationService.View> get(@PathVariable UUID workspaceId, @PathVariable UUID projectId, Authentication auth) {
        return response(conversations.get(UUID.fromString(auth.getName()), workspaceId, projectId));
    }
    @PutMapping
    public ResponseEntity<ProjectPetConversationService.View> update(@PathVariable UUID workspaceId, @PathVariable UUID projectId,
            Authentication auth, @Valid @RequestBody ProjectPetConversationService.Update input) {
        return response(conversations.update(UUID.fromString(auth.getName()), workspaceId, projectId, input));
    }
    @PostMapping("/draft")
    public ResponseEntity<ProjectPetConversationService.View> accept(@PathVariable UUID workspaceId, @PathVariable UUID projectId,
            Authentication auth, @Valid @RequestBody ProjectPetConversationService.Accept input) {
        UUID user = UUID.fromString(auth.getName());
        return response(drafts.accept(user, workspaceId, projectId, input));
    }
    private static <T> ResponseEntity<T> response(T value) { return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(value); }
}
