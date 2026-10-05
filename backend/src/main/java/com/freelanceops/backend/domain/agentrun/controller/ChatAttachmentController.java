package com.freelanceops.backend.domain.agentrun.controller;

import com.freelanceops.backend.domain.agentrun.service.ChatAttachmentService;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import java.util.UUID;

@RestController
@RequestMapping("/api/v2/workspaces/{workspaceId}/projects/{projectId}/attachments")
public class ChatAttachmentController {
    private final ChatAttachmentService service;
    public ChatAttachmentController(ChatAttachmentService service) { this.service = service; }
    @PostMapping(consumes = "multipart/form-data")
    @ResponseStatus(HttpStatus.CREATED)
    public ChatAttachmentService.Preview upload(@PathVariable UUID workspaceId, @PathVariable UUID projectId,
        @RequestPart("file") MultipartFile file, @RequestParam(defaultValue = "auto") String encoding,
        @RequestParam(defaultValue = "auto") String delimiter, Authentication auth) {
        return service.upload(UUID.fromString(auth.getName()), workspaceId, projectId, file, encoding, delimiter);
    }
    @DeleteMapping("/{attachmentId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable UUID workspaceId, @PathVariable UUID projectId, @PathVariable UUID attachmentId, Authentication auth) {
        service.delete(UUID.fromString(auth.getName()), workspaceId, projectId, attachmentId);
    }
}
