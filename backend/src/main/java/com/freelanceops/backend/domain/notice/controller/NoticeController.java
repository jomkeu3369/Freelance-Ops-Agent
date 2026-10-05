package com.freelanceops.backend.domain.notice.controller;

import com.freelanceops.backend.domain.notice.service.NoticeService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

@RestController
public class NoticeController {
    private final NoticeService service;
    public NoticeController(NoticeService service) { this.service = service; }
    @GetMapping("/api/v2/notices") public List<NoticeService.Notice> published() { return service.published(); }
    @GetMapping("/api/v2/admin/notices") public NoticeService.Dashboard dashboard(Authentication auth) { return service.dashboard(user(auth)); }
    @PostMapping("/api/v2/admin/notices") public NoticeService.Notice create(@Valid @RequestBody Draft body, Authentication auth) {
        return service.create(user(auth),body.kind(),body.title(),body.body(),body.versionLabel(),body.effectiveAt());
    }
    @PostMapping("/api/v2/admin/notices/{id}/review") public NoticeService.Notice review(@PathVariable UUID id, @Valid @RequestBody Revision body, Authentication auth) {
        return service.review(user(auth),id,body.expectedRevision());
    }
    @PostMapping("/api/v2/admin/notices/{id}/publish") public NoticeService.Notice publish(@PathVariable UUID id, @Valid @RequestBody Publication body, Authentication auth) {
        return service.publish(user(auth),id,body.expectedRevision(),body.publishAt(),body.confirmation());
    }
    @PostMapping("/api/v2/admin/notice-campaigns") public NoticeService.Campaign prepare(@Valid @RequestBody Preparation body, Authentication auth) {
        return service.prepare(user(auth),body.noticeId());
    }
    @PostMapping("/api/v2/admin/notice-campaigns/{id}/test") public NoticeService.Campaign test(@PathVariable UUID id, Authentication auth) { return service.test(user(auth),id); }
    @PostMapping("/api/v2/admin/notice-campaigns/{id}/confirm") public NoticeService.Campaign confirm(@PathVariable UUID id, @Valid @RequestBody Confirmation body, Authentication auth) {
        return service.confirm(user(auth),id,body.contentHash(),body.recipientHash(),body.recipientCount(),body.confirmation());
    }
    @PostMapping("/api/v2/admin/notice-campaigns/{id}/cancel") public NoticeService.Campaign cancel(@PathVariable UUID id, Authentication auth) { return service.cancel(user(auth),id); }
    @PostMapping("/api/v2/admin/notice-campaigns/{id}/dispatch-next") public NoticeService.Dispatch dispatch(@PathVariable UUID id, Authentication auth) { return service.dispatchNext(user(auth),id); }
    public record Draft(@NotBlank @Size(max=24) String kind, @NotBlank @Size(max=200) String title,
                        @NotNull @Size(max=20000) String body, @NotBlank @Size(max=80) String versionLabel, @NotNull Instant effectiveAt) { }
    public record Revision(@NotNull @Min(0) Long expectedRevision) { }
    public record Publication(@NotNull @Min(0) Long expectedRevision, @NotNull Instant publishAt, @NotBlank String confirmation) { }
    public record Preparation(@NotNull UUID noticeId) { }
    public record Confirmation(@NotBlank @Pattern(regexp="[a-f0-9]{64}") String contentHash,
                               @NotBlank @Pattern(regexp="[a-f0-9]{64}") String recipientHash,
                               @NotNull @Min(0) Integer recipientCount, @NotBlank String confirmation) { }
    private static UUID user(Authentication auth) {
        if (auth == null || !auth.isAuthenticated()) throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
        try { return UUID.fromString(auth.getName()); }
        catch (IllegalArgumentException error) { throw new ResponseStatusException(HttpStatus.UNAUTHORIZED); }
    }
}
