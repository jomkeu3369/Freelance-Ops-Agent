package com.freelanceops.backend.domain.agentrun.dto.request;

import com.fasterxml.jackson.annotation.JsonAnySetter;

import io.swagger.v3.oas.annotations.media.Schema;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.NotNull;

import java.math.BigDecimal;

@Schema(name = "ChangeBudgets")
public record ChangePlatformSpendBudgetsRequest(
        @NotNull @DecimalMin("0") @DecimalMax("100000") @Digits(integer = 6, fraction = 8)
                BigDecimal accountWeekUsd,
        @NotNull @DecimalMin("0") @DecimalMax("100000") @Digits(integer = 6, fraction = 8)
                BigDecimal globalDayUsd,
        @NotNull @DecimalMin("0") @DecimalMax("100000") @Digits(integer = 6, fraction = 8)
                BigDecimal globalWeekUsd,
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
