package com.freelanceops.backend.domain.agentrun.controller;

import com.freelanceops.backend.domain.agentrun.service.PlatformUsageService;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import java.util.UUID;

@RestController
public class PlatformUsageController {
    private final PlatformUsageService service;
    public PlatformUsageController(PlatformUsageService service) { this.service = service; }
    @GetMapping("/api/v2/me/ai-usage")
    public PlatformUsageService.Usage current(Authentication authentication) {
        return service.snapshot(user(authentication));
    }
    @GetMapping("/api/v2/me/ai-usage/history")
    public PlatformUsageService.History history(Authentication authentication,
        @RequestParam(required=false) String cursor, @RequestParam(defaultValue="20") int limit) {
        return service.history(user(authentication), cursor, limit);
    }
    private static UUID user(Authentication authentication) {
        if (authentication == null || !authentication.isAuthenticated()) throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
        try { return UUID.fromString(authentication.getName()); }
        catch (IllegalArgumentException error) { throw new ResponseStatusException(HttpStatus.UNAUTHORIZED); }
    }
}
