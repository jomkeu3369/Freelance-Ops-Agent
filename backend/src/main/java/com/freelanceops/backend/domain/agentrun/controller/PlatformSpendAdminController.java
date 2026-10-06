package com.freelanceops.backend.domain.agentrun.controller;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.freelanceops.backend.domain.agentrun.model.Provider;
import com.freelanceops.backend.domain.agentrun.dto.response.PlatformSpendAdminSettingsResponse;
import com.freelanceops.backend.domain.agentrun.service.PlatformSpendAdminService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.util.UUID;

@RestController
@RequestMapping("/api/v2/admin/ai-spending")
public class PlatformSpendAdminController {
    private final PlatformSpendAdminService service;
    public PlatformSpendAdminController(PlatformSpendAdminService service) { this.service = service; }

    @GetMapping
    public PlatformSpendAdminSettingsResponse settings(Authentication authentication) {
        return PlatformSpendAdminSettingsResponse.from(service.settings(user(authentication)));
    }
    @PatchMapping
    public PlatformSpendAdminSettingsResponse budgets(@Valid @RequestBody ChangeBudgets input, Authentication authentication) {
        return PlatformSpendAdminSettingsResponse.from(service.changeBudgets(user(authentication), input.accountWeekUsd(),
            input.globalDayUsd(), input.globalWeekUsd(), input.expectedRevision().longValueExact()));
    }
    @PatchMapping("/models")
    public PlatformSpendAdminSettingsResponse model(@Valid @RequestBody ChangeModel input, Authentication authentication) {
        return PlatformSpendAdminSettingsResponse.from(service.changeModel(user(authentication), input.provider(),
            input.model(), input.maxRunUsd(), input.enabled(), input.expectedRevision().longValueExact()));
    }

    public record ChangeBudgets(
        @NotNull @DecimalMin("0") @DecimalMax("100000") @Digits(integer=6,fraction=8) BigDecimal accountWeekUsd,
        @NotNull @DecimalMin("0") @DecimalMax("100000") @Digits(integer=6,fraction=8) BigDecimal globalDayUsd,
        @NotNull @DecimalMin("0") @DecimalMax("100000") @Digits(integer=6,fraction=8) BigDecimal globalWeekUsd,
        @NotNull @DecimalMin("0") @DecimalMax("9223372036854775807") @Digits(integer=19,fraction=0) BigDecimal expectedRevision) {
        @JsonAnySetter public void rejectUnknown(String field, Object value) {
            throw new IllegalArgumentException("Unsupported platform spending field: " + field);
        }
    }
    public record ChangeModel(@NotNull Provider provider, @NotBlank @Size(max=100) String model,
        @NotNull @DecimalMin("0") @DecimalMax("100") @Digits(integer=3,fraction=8) BigDecimal maxRunUsd,
        @NotNull Boolean enabled, @NotNull @DecimalMin("0") @DecimalMax("9223372036854775807") @Digits(integer=19,fraction=0) BigDecimal expectedRevision) {
        @JsonAnySetter public void rejectUnknown(String field, Object value) {
            throw new IllegalArgumentException("Unsupported platform spending field: " + field);
        }
    }

    private static UUID user(Authentication authentication) {
        if (authentication == null || !authentication.isAuthenticated()) throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
        try { return UUID.fromString(authentication.getName()); }
        catch (IllegalArgumentException error) { throw new ResponseStatusException(HttpStatus.UNAUTHORIZED); }
    }
}
