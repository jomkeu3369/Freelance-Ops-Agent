package com.freelanceops.backend.domain.agentrun.dto;

import jakarta.validation.constraints.*;

import java.util.List;

/** 외부 주소나 SVG 코드 없이 픽셀과 색상만 보관한다. */
public record PixelPetSprite(
        @NotBlank @Size(max = 32) String species,
        @NotNull @Size(min = 15, max = 15)
                List<@Pattern(regexp = "#[0-9a-fA-F]{6}") String> palette,
        @NotNull @Size(min = 32, max = 32) List<@Pattern(regexp = "[.0-9A-E]{32}") String> rows) {
    public PixelPetSprite {
        if (palette != null) palette = List.copyOf(palette);
        if (rows != null) {
            rows = List.copyOf(rows);
            long visible = rows.stream().flatMapToInt(String::chars).filter(c -> c != '.').count();
            if (visible < 48 || visible > 900)
                throw new IllegalArgumentException("Invalid pixel silhouette");
        }
    }
}
