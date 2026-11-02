package com.freelanceops.backend.domain.agentrun.controller;

import com.freelanceops.backend.domain.agentrun.dto.request.ChangePlatformSpendBudgetsRequest;
import com.freelanceops.backend.domain.agentrun.dto.request.ChangePlatformSpendModelRequest;
import com.freelanceops.backend.domain.agentrun.dto.response.PlatformSpendAdminSettingsResponse;
import com.freelanceops.backend.domain.agentrun.service.PlatformSpendAdminService;

import jakarta.validation.Valid;

import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

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
    public PlatformSpendAdminSettingsResponse budgets(@Valid @RequestBody ChangePlatformSpendBudgetsRequest input, Authentication authentication) {
        return PlatformSpendAdminSettingsResponse.from(service.changeBudgets(user(authentication), input.accountWeekUsd(),
            input.globalDayUsd(), input.globalWeekUsd(), input.expectedRevision().longValueExact()));
    }
    @PatchMapping("/models")
    public PlatformSpendAdminSettingsResponse model(@Valid @RequestBody ChangePlatformSpendModelRequest input, Authentication authentication) {
        return PlatformSpendAdminSettingsResponse.from(service.changeModel(user(authentication), input.provider(),
            input.model(), input.maxRunUsd(), input.enabled(), input.expectedRevision().longValueExact()));
    }

    private static UUID user(Authentication authentication) {
        if (authentication == null || !authentication.isAuthenticated()) throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
        try { return UUID.fromString(authentication.getName()); }
        catch (IllegalArgumentException error) { throw new ResponseStatusException(HttpStatus.UNAUTHORIZED); }
    }
}
