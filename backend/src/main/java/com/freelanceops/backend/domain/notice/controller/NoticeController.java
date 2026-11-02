package com.freelanceops.backend.domain.notice.controller;

import com.freelanceops.backend.domain.notice.dto.request.ConfirmNoticeCampaignRequest;
import com.freelanceops.backend.domain.notice.dto.request.CreateNoticeRequest;
import com.freelanceops.backend.domain.notice.dto.request.PrepareNoticeCampaignRequest;
import com.freelanceops.backend.domain.notice.dto.request.PublishNoticeRequest;
import com.freelanceops.backend.domain.notice.dto.request.ReviewNoticeRequest;
import com.freelanceops.backend.domain.notice.dto.response.NoticeCampaignResponse;
import com.freelanceops.backend.domain.notice.dto.response.NoticeDashboardResponse;
import com.freelanceops.backend.domain.notice.dto.response.NoticeDispatchResponse;
import com.freelanceops.backend.domain.notice.dto.response.NoticeResponse;
import com.freelanceops.backend.domain.notice.service.NoticeService;

import jakarta.validation.Valid;
import jakarta.validation.constraints.*;

import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.UUID;

@RestController
public class NoticeController {
    private final NoticeService service;

    public NoticeController(NoticeService service) {
        this.service = service;
    }

    @GetMapping("/api/v2/notices")
    public List<NoticeResponse> published() {
        return service.published();
    }

    @GetMapping("/api/v2/admin/notices")
    public NoticeDashboardResponse dashboard(Authentication auth) {
        return service.dashboard(user(auth));
    }

    @PostMapping("/api/v2/admin/notices")
    public NoticeResponse create(@Valid @RequestBody CreateNoticeRequest body, Authentication auth) {
        return service.create(
                user(auth),
                body.kind(),
                body.title(),
                body.body(),
                body.versionLabel(),
                body.effectiveAt());
    }

    @PostMapping("/api/v2/admin/notices/{id}/review")
    public NoticeResponse review(
            @PathVariable UUID id, @Valid @RequestBody ReviewNoticeRequest body, Authentication auth) {
        return service.review(user(auth), id, body.expectedRevision());
    }

    @PostMapping("/api/v2/admin/notices/{id}/publish")
    public NoticeResponse publish(
            @PathVariable UUID id, @Valid @RequestBody PublishNoticeRequest body, Authentication auth) {
        return service.publish(
                user(auth), id, body.expectedRevision(), body.publishAt(), body.confirmation());
    }

    @PostMapping("/api/v2/admin/notice-campaigns")
    public NoticeCampaignResponse prepare(
            @Valid @RequestBody PrepareNoticeCampaignRequest body, Authentication auth) {
        return service.prepare(user(auth), body.noticeId());
    }

    @PostMapping("/api/v2/admin/notice-campaigns/{id}/test")
    public NoticeCampaignResponse test(@PathVariable UUID id, Authentication auth) {
        return service.test(user(auth), id);
    }

    @PostMapping("/api/v2/admin/notice-campaigns/{id}/confirm")
    public NoticeCampaignResponse confirm(
            @PathVariable UUID id, @Valid @RequestBody ConfirmNoticeCampaignRequest body, Authentication auth) {
        return service.confirm(
                user(auth),
                id,
                body.contentHash(),
                body.recipientHash(),
                body.recipientCount(),
                body.confirmation());
    }

    @PostMapping("/api/v2/admin/notice-campaigns/{id}/cancel")
    public NoticeCampaignResponse cancel(@PathVariable UUID id, Authentication auth) {
        return service.cancel(user(auth), id);
    }

    @PostMapping("/api/v2/admin/notice-campaigns/{id}/dispatch-next")
    public NoticeDispatchResponse dispatch(@PathVariable UUID id, Authentication auth) {
        return service.dispatchNext(user(auth), id);
    }

    private static UUID user(Authentication auth) {
        if (auth == null || !auth.isAuthenticated())
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
        try {
            return UUID.fromString(auth.getName());
        } catch (IllegalArgumentException error) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
        }
    }
}
