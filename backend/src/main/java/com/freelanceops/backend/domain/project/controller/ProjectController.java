package com.freelanceops.backend.domain.project.controller;

import com.freelanceops.backend.domain.project.dto.request.CreateProjectRequest;
import com.freelanceops.backend.domain.project.dto.request.UpdateProjectRequest;
import com.freelanceops.backend.domain.project.dto.response.ProjectResponse;
import com.freelanceops.backend.domain.project.service.ProjectService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
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
@RequestMapping("/api/v2/workspaces/{workspaceId}/projects")
public class ProjectController {

    private final ProjectService projectService;

    public ProjectController(ProjectService projectService) {
        this.projectService = projectService;
    }

    @GetMapping
    public List<ProjectResponse> list(@PathVariable UUID workspaceId, Authentication authentication) {
        return projectService.list(userId(authentication), workspaceId);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public ProjectResponse create(@PathVariable UUID workspaceId, @Valid @RequestBody CreateProjectRequest request, Authentication authentication) {
        return projectService.create(userId(authentication), workspaceId, request);
    }

    @GetMapping("/{projectId}")
    public ProjectResponse get(@PathVariable UUID workspaceId, @PathVariable UUID projectId, Authentication authentication) {
        return projectService.get(userId(authentication), workspaceId, projectId);
    }

    @PatchMapping("/{projectId}")
    public ProjectResponse update(@PathVariable UUID workspaceId, @PathVariable UUID projectId, @Valid @RequestBody UpdateProjectRequest request, Authentication authentication) {
        return projectService.update(userId(authentication), workspaceId, projectId, request);
    }

    @DeleteMapping("/{projectId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable UUID workspaceId, @PathVariable UUID projectId, Authentication authentication) {
        projectService.delete(userId(authentication), workspaceId, projectId);
    }

    private static UUID userId(Authentication authentication) {
        try {
            return UUID.fromString(authentication.getName());
        } catch (IllegalArgumentException error) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "authenticated subject must be a UUID", error);
        }
    }
}


