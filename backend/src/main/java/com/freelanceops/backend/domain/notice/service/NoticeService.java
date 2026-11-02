package com.freelanceops.backend.domain.notice.service;

import com.freelanceops.backend.domain.notice.dto.response.NoticeCampaignResponse;
import com.freelanceops.backend.domain.notice.dto.response.NoticeDashboardResponse;
import com.freelanceops.backend.domain.notice.dto.response.NoticeDispatchResponse;
import com.freelanceops.backend.domain.notice.dto.response.NoticeResponse;
import com.freelanceops.backend.domain.notice.repository.JdbcNoticeRepository;
import com.freelanceops.backend.domain.notice.repository.JdbcNoticeRepository.Delivery;
import com.freelanceops.backend.domain.notice.repository.JdbcNoticeRepository.Recipient;
import com.freelanceops.backend.global.mail.OperationalMailTransport;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
public class NoticeService {
    private final JdbcNoticeRepository repository;
    private final OperationalMailTransport mail;
    private final int maxRecipients;
    private final Clock clock;
    private final boolean dispatchEnabled;

    @Autowired
    public NoticeService(
            JdbcNoticeRepository repository,
            OperationalMailTransport mail,
            @Value("${app.notices.max-campaign-recipients:200}") int maxRecipients,
            @Value("${app.notices.dispatch-enabled:false}") boolean dispatchEnabled) {
        this(repository, mail, maxRecipients, dispatchEnabled, Clock.systemUTC());
    }

    NoticeService(
            JdbcNoticeRepository repository,
            OperationalMailTransport mail,
            int maxRecipients,
            boolean dispatchEnabled,
            Clock clock) {
        if (maxRecipients < 1 || maxRecipients > 5000)
            throw new IllegalArgumentException("Invalid campaign recipient limit");
        this.repository = repository;
        this.mail = mail;
        this.maxRecipients = maxRecipients;
        this.clock = clock;
        this.dispatchEnabled = dispatchEnabled;
    }

    @Transactional(readOnly = true)
    public List<NoticeResponse> published() {
        return repository.listPublished(clock.instant());
    }

    @Transactional
    public NoticeDashboardResponse dashboard(UUID actor) {
        requireAdmin(actor);
        List<NoticeResponse> notices = repository.listNotices();
        List<UUID> ids = repository.listCampaignIds();
        return new NoticeDashboardResponse(
                notices, ids.stream().map(this::campaign).toList(), mail.ready());
    }

    @Transactional
    public NoticeResponse create(
            UUID actor,
            String kind,
            String title,
            String body,
            String versionLabel,
            Instant effectiveAt) {
        requireAdmin(actor);
        if (!List.of("OPERATIONAL", "TERMS_VERSION", "PRIVACY_VERSION").contains(kind))
            throw bad("Invalid notice kind");
        title = title.strip();
        body = body.strip();
        versionLabel = versionLabel.strip();
        if (title.isBlank()
                || title.length() > 200
                || title.chars().anyMatch(Character::isISOControl)
                || body.length() > 20000
                || versionLabel.isBlank()
                || versionLabel.length() > 80
                || effectiveAt == null) throw bad("Invalid notice content");
        if ("OPERATIONAL".equals(kind) && body.isBlank())
            throw bad("Operational notice content is required");
        if (!"OPERATIONAL".equals(kind) && !body.isEmpty())
            throw bad("Legal versions are metadata-only in this release");
        String hash =
                NoticeIntegrity.hash(
                        List.of(kind, title, body, versionLabel, effectiveAt.toString()));
        UUID id = UUID.randomUUID();
        repository.insertNotice(id, kind, title, body, versionLabel, effectiveAt, hash, actor);
        audit(actor, id, null, "CREATE_DRAFT", hash);
        return notice(id, false);
    }

    @Transactional
    public NoticeResponse review(UUID actor, UUID id, long expectedRevision) {
        requireAdmin(actor);
        NoticeResponse notice = notice(id, true);
        if (notice.revision() != expectedRevision || !"DRAFT".equals(notice.status()))
            throw conflict("Reload this notice before review");
        repository.markReviewed(id);
        audit(actor, id, null, "REVIEW", notice.contentHash());
        return notice(id, false);
    }

    @Transactional
    public NoticeResponse publish(
            UUID actor, UUID id, long expectedRevision, Instant publishAt, String confirmation) {
        requireAdmin(actor);
        NoticeResponse notice = notice(id, true);
        if (!"OPERATIONAL".equals(notice.kind()))
            throw conflict("Legal publication requires a separately reviewed release");
        if (notice.revision() != expectedRevision || !"REVIEWED".equals(notice.status()))
            throw conflict("Reload and review this notice before publishing");
        if (!"PUBLISH_NOTICE".equals(confirmation)
                || publishAt == null
                || publishAt.isAfter(notice.effectiveAt()))
            throw bad("Confirm publication before the effective date");
        repository.publishNotice(publishAt, id);
        audit(actor, id, null, "PUBLISH", notice.contentHash());
        return notice(id, false);
    }

    @Transactional
    public NoticeCampaignResponse prepare(UUID actor, UUID noticeId) {
        requireAdmin(actor);
        repository.lockCampaignPreparation("notice-prepare:" + actor);
        NoticeResponse notice = notice(noticeId, true);
        if (!"OPERATIONAL".equals(notice.kind())
                || !"PUBLISHED".equals(notice.status())
                || notice.publishAt().isAfter(clock.instant()))
            throw conflict("Only a currently published operational notice can be mailed");
        Integer created =
                repository.countRecentCampaigns(actor, clock.instant().minus(Duration.ofDays(1)));
        if (created != null && created >= 10)
            throw new ResponseStatusException(
                    HttpStatus.TOO_MANY_REQUESTS, "Daily campaign limit reached");
        List<Recipient> recipients = repository.listRecipients(maxRecipients + 1);
        if (recipients.size() > maxRecipients)
            throw conflict("Recipient limit exceeded; no partial audience was prepared");
        String recipientHash = recipientHash(recipients);
        UUID id = UUID.randomUUID();
        repository.insertCampaign(
                id,
                notice.id(),
                notice.title(),
                notice.body(),
                notice.versionLabel(),
                notice.contentHash(),
                recipientHash,
                recipients.size(),
                actor,
                clock.instant());
        for (Recipient recipient : recipients)
            repository.insertDelivery(UUID.randomUUID(), id, recipient.userId(), recipient.email());
        audit(actor, noticeId, id, "PREPARE_SNAPSHOT", notice.contentHash());
        return campaign(id);
    }

    @Transactional
    public NoticeCampaignResponse test(UUID actor, UUID id) {
        requireAdmin(actor);
        NoticeCampaignResponse campaign = lockCampaign(id);
        if (!"DRAFT".equals(campaign.status()))
            throw conflict("Only draft campaigns can be tested");
        List<String> self = repository.findVerifiedEmail(actor);
        if (self.isEmpty())
            throw conflict("Verify your own administrator email before a self-test");
        var testState = repository.readTestState(id);
        Instant tested = testState.testedAt();
        int count = testState.count();
        if (count >= 5 || (tested != null && tested.plusSeconds(60).isAfter(clock.instant())))
            throw new ResponseStatusException(
                    HttpStatus.TOO_MANY_REQUESTS, "Self-test cooldown or limit reached");
        OperationalMailTransport.Result result =
                mail.ready()
                        ? deliver(
                                "notice-test:" + id + ":" + count,
                                self.getFirst(),
                                "[테스트] " + campaign.snapshotTitle(),
                                campaign.snapshotBody())
                        : OperationalMailTransport.Result.BLOCKED_TRANSPORT;
        repository.updateTestState(result.name(), actor, clock.instant(), id);
        audit(actor, campaign.noticeId(), id, "TEST_" + result.name(), campaign.contentHash());
        return campaign(id);
    }

    @Transactional
    public NoticeCampaignResponse confirm(
            UUID actor,
            UUID id,
            String contentHash,
            String recipientHash,
            int recipientCount,
            String confirmation) {
        requireAdmin(actor);
        NoticeCampaignResponse campaign = lockCampaign(id);
        if (!"QUEUE_OPERATIONAL_NOTICE".equals(confirmation)
                || !campaign.contentHash().equals(contentHash)
                || !campaign.recipientHash().equals(recipientHash)
                || campaign.recipientCount() != recipientCount)
            throw conflict("The content or audience does not match the reviewed snapshot");
        // 같은 확인 요청은 기존 결과를 반환한다. 내용이 달라지면 앞선 검증에서 거부한다.
        if (List.of("QUEUED", "COMPLETED").contains(campaign.status())) return campaign;
        if (!"DRAFT".equals(campaign.status())
                || recipientCount < 1
                || campaign.createdAt().plus(Duration.ofHours(24)).isBefore(clock.instant()))
            throw conflict("This snapshot cannot be queued; prepare a fresh campaign");
        UUID tester = repository.findTester(id);
        if (!"ACCEPTED".equals(campaign.testStatus()) || !actor.equals(tester))
            throw conflict("An accepted self-test by the confirming administrator is required");
        List<Recipient> snapshot = repository.listDeliveryRecipients(id);
        if (snapshot.size() != recipientCount || !recipientHash(snapshot).equals(recipientHash))
            throw conflict("Audience changed; prepare a fresh campaign");
        repository.queueCampaign(actor, clock.instant(), id);
        repository.queueDeliveries(clock.instant(), clock.instant(), id);
        audit(actor, campaign.noticeId(), id, "CONFIRM_QUEUE", contentHash);
        return campaign(id);
    }

    @Transactional
    public NoticeCampaignResponse cancel(UUID actor, UUID id) {
        requireAdmin(actor);
        NoticeCampaignResponse campaign = lockCampaign(id);
        if ("CANCELLED".equals(campaign.status())) return campaign;
        if ("COMPLETED".equals(campaign.status()))
            throw conflict("Completed mail cannot be recalled");
        repository.cancelCampaign(clock.instant(), id);
        repository.cancelDeliveries(clock.instant(), id);
        audit(actor, campaign.noticeId(), id, "CANCEL_UNSENT", campaign.contentHash());
        return campaign(id);
    }

    /** 명시적으로 요청할 때 수신자 한 명에게만 전송한다. 자동 일괄 발송은 지원하지 않는다. */
    @Transactional
    public NoticeDispatchResponse dispatchNext(UUID actor, UUID id) {
        requireAdmin(actor);
        NoticeCampaignResponse campaign = lockCampaign(id);
        if (!"QUEUED".equals(campaign.status()))
            return new NoticeDispatchResponse(campaign.status(), 0);
        if (!dispatchEnabled || !mail.ready())
            return new NoticeDispatchResponse("BLOCKED_TRANSPORT", 0);
        List<Delivery> rows = repository.findDueDeliveries(id, clock.instant());
        if (rows.isEmpty()) {
            finishIfTerminal(id);
            return new NoticeDispatchResponse("IDLE", 0);
        }
        Delivery delivery = rows.getFirst();
        List<UUID> eligible = repository.findEligibleRecipient(delivery.userId(), delivery.email());
        if (eligible.isEmpty()) {
            repository.suppressDelivery(clock.instant(), delivery.id());
            audit(actor, campaign.noticeId(), id, "DELIVERY_SUPPRESSED", campaign.contentHash());
            finishIfTerminal(id);
            return new NoticeDispatchResponse("SUPPRESSED", 1);
        }
        OperationalMailTransport.Result result =
                deliver(
                        "notice-delivery:" + delivery.id(),
                        delivery.email(),
                        campaign.snapshotTitle(),
                        campaign.snapshotBody());
        int attempts = delivery.attempts() + 1;
        String state =
                switch (result) {
                    case ACCEPTED -> "ACCEPTED";
                    case RETRYABLE_FAILED -> attempts < 3 ? "RETRY" : "FAILED";
                    case PERMANENT_FAILED -> "FAILED";
                    case UNKNOWN -> "UNKNOWN";
                    case BOUNCED -> "BOUNCED";
                    case BLOCKED_TRANSPORT -> "QUEUED";
                };
        Instant next =
                clock.instant().plusSeconds(Math.min(3600, 60L << Math.min(attempts - 1, 5)));
        repository.recordDelivery(
                state, attempts, result.name(), next, clock.instant(), delivery.id());
        audit(actor, campaign.noticeId(), id, "DELIVERY_" + result.name(), campaign.contentHash());
        finishIfTerminal(id);
        return new NoticeDispatchResponse(state, 1);
    }

    private OperationalMailTransport.Result deliver(
            String key, String email, String title, String body) {
        try {
            OperationalMailTransport.Result result = mail.send(key, email, title, body);
            return result == null ? OperationalMailTransport.Result.UNKNOWN : result;
        } catch (RuntimeException ignored) {
            return OperationalMailTransport.Result.UNKNOWN;
        }
    }

    private void finishIfTerminal(UUID id) {
        repository.completeCampaign(id);
    }

    private NoticeResponse notice(UUID id, boolean lock) {
        List<NoticeResponse> rows = repository.findNotice(id, lock);
        if (rows.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        return rows.getFirst();
    }

    private NoticeCampaignResponse lockCampaign(UUID id) {
        List<UUID> rows = repository.lockCampaign(id);
        if (rows.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        return campaign(id);
    }

    private NoticeCampaignResponse campaign(UUID id) {
        Map<String, Integer> counts = new LinkedHashMap<>();
        repository.collectDeliveryCounts(id, counts);
        return repository.findCampaign(id, counts);
    }

    private void requireAdmin(UUID actor) {
        List<UUID> grants = repository.findAdminGrant(actor);
        if (grants.isEmpty())
            throw new ResponseStatusException(
                    HttpStatus.FORBIDDEN, "Independent notice administrator capability required");
    }

    private void audit(UUID actor, UUID notice, UUID campaign, String action, String hash) {
        repository.insertAudit(UUID.randomUUID(), actor, notice, campaign, action, hash);
    }

    private static String recipientHash(List<Recipient> recipients) {
        List<String> fields = new ArrayList<>();
        for (Recipient recipient : recipients) {
            fields.add(recipient.userId().toString());
            fields.add(recipient.email());
        }
        return NoticeIntegrity.hash(fields);
    }

    private static ResponseStatusException bad(String message) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, message);
    }

    private static ResponseStatusException conflict(String message) {
        return new ResponseStatusException(HttpStatus.CONFLICT, message);
    }
}
