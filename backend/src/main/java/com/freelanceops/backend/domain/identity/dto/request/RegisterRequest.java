package com.freelanceops.backend.domain.identity.dto.request;

import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import tools.jackson.databind.annotation.JsonDeserialize;

public record RegisterRequest(
    @NotBlank @Email @Size(max = 320) String email,
    @NotBlank @Size(min = 12, max = 72) String password,
    @NotBlank @Size(max = 100) String displayName,
    @NotBlank @Size(max = 120) String workspaceName,
    @NotNull(message = "만 14세 이상 여부를 확인해 주세요.")
    @AssertTrue(message = "만 14세 이상만 가입할 수 있습니다.")
    @JsonDeserialize(using = StrictBooleanDeserializer.class)
    Boolean ageAtLeast14
) {
}
