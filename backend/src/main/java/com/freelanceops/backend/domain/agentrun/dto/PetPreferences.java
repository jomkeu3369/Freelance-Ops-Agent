package com.freelanceops.backend.domain.agentrun.dto;

import jakarta.validation.constraints.*;
import java.util.List;

/** User-authored preferences are data, never authorization or system instructions. */
public record PetPreferences(
    @NotNull @Size(max = 500) String personality,
    @NotNull @Size(max = 500) String communication,
    @NotNull @Size(max = 500) String focus,
    @NotNull @Size(max = 500) String responsibility,
    @NotNull @Size(max = 6) List<@NotBlank @Size(max = 500) String> requests
) {
    public static PetPreferences empty() { return new PetPreferences("", "", "", "", List.of()); }
}
