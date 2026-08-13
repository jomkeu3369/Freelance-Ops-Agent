package com.freelanceops.backend.domain.requirement.controller;

import com.freelanceops.backend.domain.requirement.dto.request.CreateRequirementVersionRequest;
import com.freelanceops.backend.domain.requirement.dto.response.RequirementVersionResponse;
import com.freelanceops.backend.domain.requirement.service.RequirementService;
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
@RequestMapping("/api/v2/workspaces/{workspaceId}/projects/{projectId}/requirements")
public class RequirementController {
    private final RequirementService requirementService;

    public RequirementController(RequirementService requirementService) {
        this.requirementService = requirementService;
    }

    @GetMapping
    public List<RequirementVersionResponse> list(@PathVariable UUID workspaceId, @PathVariable UUID projectId, Authentication authentication) {
        return requirementService.list(userId(authentication), workspaceId, projectId);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public RequirementVersionResponse create(@PathVariable UUID workspaceId, @PathVariable UUID projectId, @Valid @RequestBody CreateRequirementVersionRequest request, Authentication authentication) {
        return requirementService.create(userId(authentication), workspaceId, projectId, request);
    }

    @GetMapping("/{requirementVersionId}")
    public RequirementVersionResponse get(@PathVariable UUID workspaceId, @PathVariable UUID projectId, @PathVariable UUID requirementVersionId, Authentication authentication) {
        return requirementService.get(userId(authentication), workspaceId, projectId, requirementVersionId);
    }

    private static UUID userId(Authentication authentication) {
        try {
            return UUID.fromString(authentication.getName());
        } catch (IllegalArgumentException error) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "authenticated subject must be a UUID", error);
        }
    }
}
