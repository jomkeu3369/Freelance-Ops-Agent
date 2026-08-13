package com.freelanceops.backend.domain.internaltool.dto.response;

import java.util.List;

public record RequirementValidationResult(boolean valid, List<String> errors, List<String> warnings) {
}
