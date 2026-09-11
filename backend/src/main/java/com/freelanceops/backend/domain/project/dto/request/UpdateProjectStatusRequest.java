package com.freelanceops.backend.domain.project.dto.request;

import com.freelanceops.backend.domain.project.model.ProjectStatus;
import jakarta.validation.constraints.NotNull;

public record UpdateProjectStatusRequest(@NotNull ProjectStatus status) {
}
