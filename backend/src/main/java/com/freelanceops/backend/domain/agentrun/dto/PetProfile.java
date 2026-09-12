package com.freelanceops.backend.domain.agentrun.dto;

import jakarta.validation.constraints.*;
import java.util.List;

public record PetProfile(
    @NotNull @Pattern(regexp = "LEAN|RECOMMENDED|EXPANDED") String slot,
    @NotBlank @Size(max = 20) @Pattern(regexp = "[\\p{L}\\p{N} _-]+") String name,
    @NotNull @Pattern(regexp = "turtle|owl|cat") String animal,
    @NotNull @Pattern(regexp = "sage|lavender|peach|sky|rose|ink") String color,
    @NotNull @Pattern(regexp = "none|glasses|scarf|star") String accessory,
    @NotNull @Pattern(regexp = "WARM|DIRECT|FORMAL") String tone,
    @NotNull @Pattern(regexp = "PROFIT|BALANCED|RELATIONSHIP") String valuePriority,
    @NotNull @Pattern(regexp = "SPEED|BALANCED|QUALITY") String deliveryPriority,
    @NotNull @Pattern(regexp = "CAUTIOUS|BALANCED|EXPLORATORY") String scopePriority
) {
    public static List<PetProfile> defaults() {
        return List.of(
            new PetProfile("LEAN", "차근", "turtle", "sage", "none", "WARM", "BALANCED", "SPEED", "CAUTIOUS"),
            new PetProfile("RECOMMENDED", "또렷", "owl", "lavender", "none", "FORMAL", "BALANCED", "QUALITY", "BALANCED"),
            new PetProfile("EXPANDED", "든든", "cat", "peach", "none", "DIRECT", "PROFIT", "BALANCED", "EXPLORATORY")
        );
    }
}
