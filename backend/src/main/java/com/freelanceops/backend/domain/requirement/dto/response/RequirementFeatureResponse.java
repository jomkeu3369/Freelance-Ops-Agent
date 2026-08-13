package com.freelanceops.backend.domain.requirement.dto.response;

import com.freelanceops.backend.domain.requirement.model.RequirementPriority;

public record RequirementFeatureResponse(String title, String description, RequirementPriority priority, String acceptanceCriteria) {
}
