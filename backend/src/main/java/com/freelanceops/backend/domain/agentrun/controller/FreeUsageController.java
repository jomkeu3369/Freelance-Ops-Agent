package com.freelanceops.backend.domain.agentrun.controller;

import com.freelanceops.backend.domain.agentrun.dto.request.ChangeFreeUsageLimitRequest;
import com.freelanceops.backend.domain.agentrun.dto.request.ChangeFreeUsageModelRequest;
import com.freelanceops.backend.domain.agentrun.dto.request.ResetFreeUsageRequest;
import com.freelanceops.backend.domain.agentrun.dto.response.FreeUsageResponse;
import com.freelanceops.backend.domain.agentrun.dto.response.FreeUsageSettingsResponse;
import com.freelanceops.backend.domain.agentrun.service.FreeUsageService;

import jakarta.validation.Valid;

import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.util.UUID;

@RestController
public class FreeUsageController {
    private final FreeUsageService service;

    public FreeUsageController(FreeUsageService service) {
        this.service = service;
    }

    @GetMapping("/api/v2/usage/free")
    public FreeUsageResponse current(Authentication authentication) {
        return service.current(user(authentication));
    }

    @GetMapping("/api/v2/admin/free-usage")
    public FreeUsageSettingsResponse settings(Authentication authentication) {
        return service.adminSettings(user(authentication));
    }

    @PatchMapping("/api/v2/admin/free-usage")
    public FreeUsageSettingsResponse change(
            @Valid @RequestBody ChangeFreeUsageLimitRequest input, Authentication authentication) {
        return service.changeLimit(
                user(authentication),
                input.limit().intValueExact(),
                input.expectedEpoch(),
                input.expectedUpdatedAt());
    }

    @PatchMapping("/api/v2/admin/free-usage/models")
    public FreeUsageSettingsResponse changeModel(
            @Valid @RequestBody ChangeFreeUsageModelRequest input, Authentication authentication) {
        return service.changeModelRate(
                user(authentication),
                input.provider(),
                input.model(),
                input.credits().intValueExact(),
                input.enabled(),
                input.expectedEpoch(),
                input.expectedUpdatedAt());
    }

    @PostMapping("/api/v2/admin/free-usage/reset")
    public FreeUsageSettingsResponse reset(
            @Valid @RequestBody ResetFreeUsageRequest input, Authentication authentication) {
        return service.resetAll(
                user(authentication),
                input.confirmation(),
                input.expectedEpoch(),
                input.expectedUpdatedAt());
    }

    private static UUID user(Authentication authentication) {
        if (authentication == null || !authentication.isAuthenticated())
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
        try {
            return UUID.fromString(authentication.getName());
        } catch (IllegalArgumentException error) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
        }
    }
}
