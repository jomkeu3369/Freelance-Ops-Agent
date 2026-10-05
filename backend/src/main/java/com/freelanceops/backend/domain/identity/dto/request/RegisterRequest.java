package com.freelanceops.backend.domain.identity.dto.request;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import tools.jackson.databind.annotation.JsonDeserialize;

public record RegisterRequest(
    @NotBlank @Email @Size(max = 320) String email,
    @NotBlank @Size(min = 12, max = 72) String password,
    @NotBlank @Size(max = 100) String displayName,
    @NotBlank @Size(max = 120) String workspaceName,
    @JsonDeserialize(using = StrictBooleanDeserializer.class)
    Boolean ageAtLeast14
) {
    public RegisterRequest(String email, String password, String displayName, String workspaceName) {
        this(email, password, displayName, workspaceName, null);
    }
}
