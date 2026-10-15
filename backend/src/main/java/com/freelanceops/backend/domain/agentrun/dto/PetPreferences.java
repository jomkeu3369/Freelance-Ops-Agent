package com.freelanceops.backend.domain.agentrun.dto;

import jakarta.validation.constraints.*;

import java.util.List;

/** 사용자 선호는 참고 데이터이며 권한이나 시스템 지시로 해석하지 않는다. */
public record PetPreferences(
        @NotNull @Size(max = 500) String personality,
        @NotNull @Size(max = 500) String communication,
        @NotNull @Size(max = 500) String focus,
        @NotNull @Size(max = 500) String responsibility,
        @NotNull @Size(max = 6) List<@NotBlank @Size(max = 500) String> requests) {
    public static PetPreferences empty() {
        return new PetPreferences("", "", "", "", List.of());
    }
}
