package com.freelanceops.backend.domain.project.service;

import com.freelanceops.backend.domain.project.entity.ProjectEntity;
import com.freelanceops.backend.domain.project.repository.ProjectRepository;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.util.UUID;

@Service
public class ProjectDeletionTransaction {

    private final ProjectRepository repository;

    public ProjectDeletionTransaction(ProjectRepository repository) {
        this.repository = repository;
    }

    @Transactional
    public void begin(UUID workspaceId, UUID projectId) {
        ProjectEntity project = lock(workspaceId, projectId);
        project.requestDeletion(Instant.now());
    }

    @Transactional
    public void finish(UUID workspaceId, UUID projectId) {
        ProjectEntity project = lock(workspaceId, projectId);
        if (!project.deletionRequested()) {
            throw new IllegalStateException("project deletion was not fenced");
        }
        repository.delete(project);
    }

    private ProjectEntity lock(UUID workspaceId, UUID projectId) {
        return repository.findByIdAndWorkspaceIdForUpdate(projectId, workspaceId)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
    }
}
