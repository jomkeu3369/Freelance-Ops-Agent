package com.freelanceops.backend.domain.agentrun.dto.request;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.freelanceops.backend.domain.agentrun.model.Provider;

import io.swagger.v3.oas.annotations.media.Schema;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.math.BigDecimal;

@Schema(name = "ChangeModel")
public record ChangePlatformSpendModelRequest(
        @NotNull Provider provider,
        @NotBlank @Size(max = 100) String model,
        @NotNull @DecimalMin("0") @DecimalMax("100") @Digits(integer = 3, fraction = 8)
                BigDecimal maxRunUsd,
        @NotNull Boolean enabled,
        @NotNull
                @DecimalMin("0")
                @DecimalMax("9223372036854775807")
                @Digits(integer = 19, fraction = 0)
                BigDecimal expectedRevision) {
    @JsonAnySetter
    public void rejectUnknown(String field, Object value) {
        throw new IllegalArgumentException("Unsupported platform spending field: " + field);
    }
}
