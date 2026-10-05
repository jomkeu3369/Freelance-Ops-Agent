package com.freelanceops.backend.domain.agentrun.controller;

import com.freelanceops.backend.domain.agentrun.service.FreeUsageService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import com.freelanceops.backend.domain.agentrun.model.Provider;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Digits;
import java.math.BigDecimal;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.util.UUID;

@RestController
public class FreeUsageController {
    private final FreeUsageService service;
    public FreeUsageController(FreeUsageService service) { this.service = service; }

    @GetMapping("/api/v2/usage/free")
    public FreeUsageService.Usage current(Authentication authentication) {
        return service.current(user(authentication));
    }
    @GetMapping("/api/v2/admin/free-usage")
    public FreeUsageService.Settings settings(Authentication authentication) {
        return service.adminSettings(user(authentication));
    }
    @PatchMapping("/api/v2/admin/free-usage")
    public FreeUsageService.Settings change(@Valid @RequestBody ChangeLimit input, Authentication authentication) {
        return service.changeLimit(user(authentication), input.limit().intValueExact(), input.expectedEpoch(), input.expectedUpdatedAt());
    }
    @PatchMapping("/api/v2/admin/free-usage/models")
    public FreeUsageService.Settings changeModel(@Valid @RequestBody ChangeModel input, Authentication authentication) {
        return service.changeModelRate(user(authentication), input.provider(), input.model(), input.credits().intValueExact(),
            input.enabled(), input.expectedEpoch(), input.expectedUpdatedAt());
    }
    @PostMapping("/api/v2/admin/free-usage/reset")
    public FreeUsageService.Settings reset(@Valid @RequestBody ResetAll input, Authentication authentication) {
        return service.resetAll(user(authentication), input.confirmation(), input.expectedEpoch(), input.expectedUpdatedAt());
    }

    public record ChangeLimit(@NotNull @Min(0) @Max(FreeUsageService.MAX_LIMIT) @Digits(integer = 6, fraction = 0) BigDecimal limit,
                              @NotNull @Min(0) Long expectedEpoch, @NotNull Instant expectedUpdatedAt) { }
    public record ChangeModel(@NotNull Provider provider, @NotBlank @Size(max = 100) String model,
                              @NotNull @Min(1) @Max(FreeUsageService.MAX_LIMIT) @Digits(integer = 6, fraction = 0) BigDecimal credits,
                              @NotNull Boolean enabled, @NotNull @Min(0) Long expectedEpoch, @NotNull Instant expectedUpdatedAt) { }
    public record ResetAll(@NotNull String confirmation, @NotNull @Min(0) Long expectedEpoch, @NotNull Instant expectedUpdatedAt) { }

    private static UUID user(Authentication authentication) {
        if (authentication == null || !authentication.isAuthenticated()) throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
        try { return UUID.fromString(authentication.getName()); }
        catch (IllegalArgumentException error) { throw new ResponseStatusException(HttpStatus.UNAUTHORIZED); }
    }
}
