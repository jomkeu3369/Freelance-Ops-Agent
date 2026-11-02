package com.freelanceops.backend.domain.identity.controller;

import com.freelanceops.backend.domain.agentrun.dto.response.PlatformUsageHistoryResponse;
import com.freelanceops.backend.domain.agentrun.dto.response.PlatformUsageResponse;
import com.freelanceops.backend.domain.identity.dto.response.AdminMemberAuditResponse;
import com.freelanceops.backend.domain.identity.dto.response.AdminMemberLoginResponse;
import com.freelanceops.backend.domain.identity.dto.response.AdminMemberResponse;
import com.freelanceops.backend.domain.identity.dto.response.AdminMemberSummaryResponse;
import com.freelanceops.backend.domain.identity.dto.response.Page;
import com.freelanceops.backend.domain.identity.service.AdminMemberService;

import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.UUID;

@RestController
@RequestMapping("/api/v2/admin")
public class AdminMemberController {
    private final AdminMemberService service;

    public AdminMemberController(AdminMemberService service) {
        this.service = service;
    }

    @GetMapping("/members")
    public Page<AdminMemberResponse> members(
            Authentication auth,
            @RequestParam(defaultValue = "") String q,
            @RequestParam(defaultValue = "") String status,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "25") int size) {
        return service.members(actor(auth), q, status, page, size);
    }

    @GetMapping("/members/summary")
    public AdminMemberSummaryResponse summary(Authentication auth) {
        return service.summary(actor(auth));
    }

    @GetMapping("/members/{id}")
    public AdminMemberResponse member(Authentication auth, @PathVariable UUID id) {
        return service.member(actor(auth), id);
    }

    @GetMapping("/members/{id}/ai-usage")
    public PlatformUsageResponse usage(Authentication auth, @PathVariable UUID id) {
        return service.usage(actor(auth), id);
    }

    @GetMapping("/members/{id}/ai-usage/history")
    public PlatformUsageHistoryResponse usageHistory(
            Authentication auth,
            @PathVariable UUID id,
            @RequestParam(required = false) String cursor,
            @RequestParam(defaultValue = "20") int limit) {
        return service.usageHistory(actor(auth), id, cursor, limit);
    }

    @GetMapping("/login-events")
    public Page<AdminMemberLoginResponse> logins(
            Authentication auth,
            @RequestParam(required = false) UUID userId,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "25") int size) {
        return service.logins(actor(auth), userId, page, size);
    }

    @GetMapping("/member-audit-events")
    public Page<AdminMemberAuditResponse> audits(
            Authentication auth,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "25") int size) {
        return service.audits(actor(auth), page, size);
    }

    private static UUID actor(Authentication auth) {
        if (auth == null || !auth.isAuthenticated())
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
        try {
            return UUID.fromString(auth.getName());
        } catch (IllegalArgumentException error) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
        }
    }
}
