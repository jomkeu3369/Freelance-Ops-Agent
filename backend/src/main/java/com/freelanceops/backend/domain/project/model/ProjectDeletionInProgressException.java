package com.freelanceops.backend.domain.project.model;

public class ProjectDeletionInProgressException extends RuntimeException {
    public ProjectDeletionInProgressException() {
        super("project deletion is in progress");
    }
}
