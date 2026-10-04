package com.freelanceops.backend.domain.notice.service;

import com.freelanceops.backend.global.mail.OperationalMailTransport;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.sql.Timestamp;
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
    private final JdbcTemplate jdbc;
    private final OperationalMailTransport mail;
    private final int maxRecipients;
    private final Clock clock;
    private final boolean dispatchEnabled;
    @Autowired
    public NoticeService(JdbcTemplate jdbc, OperationalMailTransport mail,
        @Value("${app.notices.max-campaign-recipients:200}") int maxRecipients,
        @Value("${app.notices.dispatch-enabled:false}") boolean dispatchEnabled) {
        this(jdbc, mail, maxRecipients, dispatchEnabled, Clock.systemUTC());
    }
    NoticeService(JdbcTemplate jdbc, OperationalMailTransport mail, int maxRecipients, boolean dispatchEnabled, Clock clock) {
        if (maxRecipients < 1 || maxRecipients > 5000) throw new IllegalArgumentException("Invalid campaign recipient limit");
        this.jdbc = jdbc; this.mail = mail; this.maxRecipients = maxRecipients; this.clock = clock; this.dispatchEnabled = dispatchEnabled;
    }
    public record Notice(UUID id, String kind, String title, String body, String versionLabel, Instant effectiveAt,
                         Instant publishAt, String status, String contentHash, long revision) { }
    public record Campaign(UUID id, UUID noticeId, String snapshotTitle, String snapshotBody, String snapshotVersionLabel,
                           String status, String contentHash, String recipientHash, int recipientCount, String testStatus,
                           Instant createdAt, Map<String, Integer> deliveries) { }
    public record Dashboard(List<Notice> notices, List<Campaign> campaigns, boolean transportReady) { }
    public record Dispatch(String status, int processed) { }
    private record Recipient(UUID userId, String email) { }
    private record Delivery(UUID id, UUID userId, String email, int attempts) { }
    private static final RowMapper<Notice> NOTICE = (row, n) -> new Notice(row.getObject("id", UUID.class), row.getString("kind"),
        row.getString("title"), row.getString("body"), row.getString("version_label"), row.getTimestamp("effective_at").toInstant(),
        instant(row.getTimestamp("publish_at")), row.getString("status"), row.getString("content_hash"), row.getLong("revision"));

    @Transactional(readOnly = true)
    public List<Notice> published() {
        return jdbc.query("SELECT * FROM app.service_notice WHERE kind = 'OPERATIONAL' AND status = 'PUBLISHED' AND publish_at <= ? ORDER BY publish_at DESC LIMIT 100",
            NOTICE, Timestamp.from(clock.instant()));
    }
    @Transactional
    public Dashboard dashboard(UUID actor) {
        requireAdmin(actor);
        List<Notice> notices = jdbc.query("SELECT * FROM app.service_notice ORDER BY created_at DESC LIMIT 100", NOTICE);
        List<UUID> ids = jdbc.query("SELECT id FROM app.notice_campaign ORDER BY created_at DESC LIMIT 100", (row, n) -> row.getObject(1, UUID.class));
        return new Dashboard(notices, ids.stream().map(this::campaign).toList(), mail.ready());
    }
    @Transactional
    public Notice create(UUID actor, String kind, String title, String body, String versionLabel, Instant effectiveAt) {
        requireAdmin(actor);
        if (!List.of("OPERATIONAL", "TERMS_VERSION", "PRIVACY_VERSION").contains(kind)) throw bad("Invalid notice kind");
        title = title.strip(); body = body.strip(); versionLabel = versionLabel.strip();
        if (title.isBlank() || title.length() > 200 || title.chars().anyMatch(Character::isISOControl) || body.length() > 20000 || versionLabel.isBlank() || versionLabel.length() > 80 || effectiveAt == null)
            throw bad("Invalid notice content");
        if ("OPERATIONAL".equals(kind) && body.isBlank()) throw bad("Operational notice content is required");
        if (!"OPERATIONAL".equals(kind) && !body.isEmpty()) throw bad("Legal versions are metadata-only in this release");
        String hash = NoticeIntegrity.hash(List.of(kind, title, body, versionLabel, effectiveAt.toString()));
        UUID id = UUID.randomUUID();
        jdbc.update("""
            INSERT INTO app.service_notice (id,kind,title,body,version_label,effective_at,status,content_hash,created_by)
            VALUES (?,?,?,?,?,?,'DRAFT',?,?)
            """, id, kind, title, body, versionLabel, Timestamp.from(effectiveAt), hash, actor);
        audit(actor, id, null, "CREATE_DRAFT", hash);
        return notice(id, false);
    }
    @Transactional
    public Notice review(UUID actor, UUID id, long expectedRevision) {
        requireAdmin(actor);
        Notice notice = notice(id, true);
        if (notice.revision() != expectedRevision || !"DRAFT".equals(notice.status())) throw conflict("Reload this notice before review");
        jdbc.update("UPDATE app.service_notice SET status = 'REVIEWED', revision = revision + 1 WHERE id = ?", id);
        audit(actor, id, null, "REVIEW", notice.contentHash());
        return notice(id, false);
    }
    @Transactional
    public Notice publish(UUID actor, UUID id, long expectedRevision, Instant publishAt, String confirmation) {
        requireAdmin(actor);
        Notice notice = notice(id, true);
        if (!"OPERATIONAL".equals(notice.kind())) throw conflict("Legal publication requires a separately reviewed release");
        if (notice.revision() != expectedRevision || !"REVIEWED".equals(notice.status())) throw conflict("Reload and review this notice before publishing");
        if (!"PUBLISH_NOTICE".equals(confirmation) || publishAt == null || publishAt.isAfter(notice.effectiveAt())) throw bad("Confirm publication before the effective date");
        jdbc.update("UPDATE app.service_notice SET status = 'PUBLISHED', publish_at = ?, revision = revision + 1 WHERE id = ?", Timestamp.from(publishAt), id);
        audit(actor, id, null, "PUBLISH", notice.contentHash());
        return notice(id, false);
    }
    @Transactional
    public Campaign prepare(UUID actor, UUID noticeId) {
        requireAdmin(actor);
        jdbc.query("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))", (row,n) -> 0, "notice-prepare:" + actor);
        Notice notice = notice(noticeId, true);
        if (!"OPERATIONAL".equals(notice.kind()) || !"PUBLISHED".equals(notice.status()) || notice.publishAt().isAfter(clock.instant()))
            throw conflict("Only a currently published operational notice can be mailed");
        Integer created = jdbc.queryForObject("SELECT COUNT(*) FROM app.notice_campaign WHERE created_by = ? AND created_at > ?", Integer.class,
            actor, Timestamp.from(clock.instant().minus(Duration.ofDays(1))));
        if (created != null && created >= 10) throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "Daily campaign limit reached");
        List<Recipient> recipients = jdbc.query("""
            SELECT id,email FROM app.user_account WHERE status = 'ACTIVE' AND email_verified_at IS NOT NULL
            AND email_verification_required = FALSE ORDER BY id LIMIT ? FOR SHARE
            """, (row, n) -> new Recipient(row.getObject(1, UUID.class), row.getString(2)), maxRecipients + 1);
        if (recipients.size() > maxRecipients) throw conflict("Recipient limit exceeded; no partial audience was prepared");
        String recipientHash = recipientHash(recipients);
        UUID id = UUID.randomUUID();
        jdbc.update("""
            INSERT INTO app.notice_campaign(id,notice_id,snapshot_title,snapshot_body,snapshot_version_label,content_hash,
              recipient_hash,recipient_count,status,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,'DRAFT',?,?)
            """, id, notice.id(), notice.title(), notice.body(), notice.versionLabel(), notice.contentHash(), recipientHash,
            recipients.size(), actor, Timestamp.from(clock.instant()));
        for (Recipient recipient : recipients) jdbc.update("""
            INSERT INTO app.notice_delivery(id,campaign_id,user_id,recipient_email,status) VALUES (?,?,?,?,'PREPARED')
            """, UUID.randomUUID(), id, recipient.userId(), recipient.email());
        audit(actor, noticeId, id, "PREPARE_SNAPSHOT", notice.contentHash());
        return campaign(id);
    }
    @Transactional
    public Campaign test(UUID actor, UUID id) {
        requireAdmin(actor);
        Campaign campaign = lockCampaign(id);
        if (!"DRAFT".equals(campaign.status())) throw conflict("Only draft campaigns can be tested");
        List<String> self = jdbc.query("SELECT email FROM app.user_account WHERE id = ? AND status = 'ACTIVE' AND email_verified_at IS NOT NULL AND email_verification_required = FALSE FOR SHARE",
            (row, n) -> row.getString(1), actor);
        if (self.isEmpty()) throw conflict("Verify your own administrator email before a self-test");
        var testState = jdbc.queryForMap("SELECT tested_at,test_count FROM app.notice_campaign WHERE id = ?", id);
        Timestamp tested = (Timestamp) testState.get("tested_at");
        int count = ((Number)testState.get("test_count")).intValue();
        if (count >= 5 || (tested != null && tested.toInstant().plusSeconds(60).isAfter(clock.instant())))
            throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "Self-test cooldown or limit reached");
        OperationalMailTransport.Result result = mail.ready()
            ? deliver("notice-test:" + id + ":" + count, self.getFirst(), "[테스트] " + campaign.snapshotTitle(), campaign.snapshotBody())
            : OperationalMailTransport.Result.BLOCKED_TRANSPORT;
        jdbc.update("UPDATE app.notice_campaign SET test_status=?,test_by=?,tested_at=?,test_count=test_count+1 WHERE id=?",
            result.name(), actor, Timestamp.from(clock.instant()), id);
        audit(actor, campaign.noticeId(), id, "TEST_" + result.name(), campaign.contentHash());
        return campaign(id);
    }
    @Transactional
    public Campaign confirm(UUID actor, UUID id, String contentHash, String recipientHash, int recipientCount, String confirmation) {
        requireAdmin(actor);
        Campaign campaign = lockCampaign(id);
        if (!"QUEUE_OPERATIONAL_NOTICE".equals(confirmation) || !campaign.contentHash().equals(contentHash)
            || !campaign.recipientHash().equals(recipientHash) || campaign.recipientCount() != recipientCount)
            throw conflict("The content or audience does not match the reviewed snapshot");
        // Identical confirmation is idempotent. A changed request never passes the checks above.
        if (List.of("QUEUED", "COMPLETED").contains(campaign.status())) return campaign;
        if (!"DRAFT".equals(campaign.status()) || recipientCount < 1 || campaign.createdAt().plus(Duration.ofHours(24)).isBefore(clock.instant()))
            throw conflict("This snapshot cannot be queued; prepare a fresh campaign");
        UUID tester = jdbc.queryForObject("SELECT test_by FROM app.notice_campaign WHERE id=?", UUID.class, id);
        if (!"ACCEPTED".equals(campaign.testStatus()) || !actor.equals(tester)) throw conflict("An accepted self-test by the confirming administrator is required");
        List<Recipient> snapshot = jdbc.query("SELECT user_id,recipient_email FROM app.notice_delivery WHERE campaign_id=? ORDER BY user_id",
            (row, n) -> new Recipient(row.getObject(1, UUID.class), row.getString(2)), id);
        if (snapshot.size() != recipientCount || !recipientHash(snapshot).equals(recipientHash)) throw conflict("Audience changed; prepare a fresh campaign");
        jdbc.update("UPDATE app.notice_campaign SET status='QUEUED',confirmed_by=?,confirmed_at=? WHERE id=?", actor, Timestamp.from(clock.instant()), id);
        jdbc.update("UPDATE app.notice_delivery SET status='QUEUED',next_attempt_at=?,updated_at=? WHERE campaign_id=? AND status='PREPARED'",
            Timestamp.from(clock.instant()), Timestamp.from(clock.instant()), id);
        audit(actor, campaign.noticeId(), id, "CONFIRM_QUEUE", contentHash);
        return campaign(id);
    }
    @Transactional
    public Campaign cancel(UUID actor, UUID id) {
        requireAdmin(actor);
        Campaign campaign = lockCampaign(id);
        if ("CANCELLED".equals(campaign.status())) return campaign;
        if ("COMPLETED".equals(campaign.status())) throw conflict("Completed mail cannot be recalled");
        jdbc.update("UPDATE app.notice_campaign SET status='CANCELLED',cancelled_at=? WHERE id=?", Timestamp.from(clock.instant()), id);
        jdbc.update("UPDATE app.notice_delivery SET status='CANCELLED',updated_at=? WHERE campaign_id=? AND status IN ('PREPARED','QUEUED','RETRY')",
            Timestamp.from(clock.instant()), id);
        audit(actor, campaign.noticeId(), id, "CANCEL_UNSENT", campaign.contentHash());
        return campaign(id);
    }
    /** Explicit, one-recipient dispatch only. No scheduler, paid provider, or implicit bulk-send path is installed. */
    @Transactional
    public Dispatch dispatchNext(UUID actor, UUID id) {
        requireAdmin(actor);
        Campaign campaign = lockCampaign(id);
        if (!"QUEUED".equals(campaign.status())) return new Dispatch(campaign.status(), 0);
        if (!dispatchEnabled || !mail.ready()) return new Dispatch("BLOCKED_TRANSPORT", 0);
        List<Delivery> rows = jdbc.query("""
            SELECT id,user_id,recipient_email,attempts FROM app.notice_delivery WHERE campaign_id=? AND status IN ('QUEUED','RETRY')
            AND next_attempt_at <= ? ORDER BY next_attempt_at,id LIMIT 1 FOR UPDATE SKIP LOCKED
            """, (row, n) -> new Delivery(row.getObject(1, UUID.class), row.getObject(2, UUID.class), row.getString(3), row.getInt(4)), id, Timestamp.from(clock.instant()));
        if (rows.isEmpty()) { finishIfTerminal(id); return new Dispatch("IDLE", 0); }
        Delivery delivery = rows.getFirst();
        List<UUID> eligible = jdbc.query("""
            SELECT id FROM app.user_account WHERE id=? AND email=? AND status='ACTIVE' AND email_verified_at IS NOT NULL
            AND email_verification_required=FALSE FOR SHARE
            """, (row, n) -> row.getObject(1, UUID.class), delivery.userId(), delivery.email());
        if (eligible.isEmpty()) {
            jdbc.update("UPDATE app.notice_delivery SET status='SUPPRESSED',last_result='INELIGIBLE',updated_at=? WHERE id=?", Timestamp.from(clock.instant()), delivery.id());
            audit(actor, campaign.noticeId(), id, "DELIVERY_SUPPRESSED", campaign.contentHash());
            finishIfTerminal(id); return new Dispatch("SUPPRESSED", 1);
        }
        OperationalMailTransport.Result result = deliver("notice-delivery:" + delivery.id(), delivery.email(), campaign.snapshotTitle(), campaign.snapshotBody());
        int attempts = delivery.attempts() + 1;
        String state = switch(result) {
            case ACCEPTED -> "ACCEPTED";
            case RETRYABLE_FAILED -> attempts < 3 ? "RETRY" : "FAILED";
            case PERMANENT_FAILED -> "FAILED";
            case UNKNOWN -> "UNKNOWN";
            case BOUNCED -> "BOUNCED";
            case BLOCKED_TRANSPORT -> "QUEUED";
        };
        Instant next = clock.instant().plusSeconds(Math.min(3600, 60L << Math.min(attempts - 1, 5)));
        jdbc.update("UPDATE app.notice_delivery SET status=?,attempts=?,last_result=?,next_attempt_at=?,updated_at=? WHERE id=?",
            state, attempts, result.name(), Timestamp.from(next), Timestamp.from(clock.instant()), delivery.id());
        audit(actor, campaign.noticeId(), id, "DELIVERY_" + result.name(), campaign.contentHash());
        finishIfTerminal(id);
        return new Dispatch(state, 1);
    }
    private OperationalMailTransport.Result deliver(String key, String email, String title, String body) {
        try {
            OperationalMailTransport.Result result = mail.send(key, email, title, body);
            return result == null ? OperationalMailTransport.Result.UNKNOWN : result;
        } catch (RuntimeException ignored) { return OperationalMailTransport.Result.UNKNOWN; }
    }
    private void finishIfTerminal(UUID id) {
        jdbc.update("""
            UPDATE app.notice_campaign SET status='COMPLETED' WHERE id=? AND status='QUEUED'
            AND NOT EXISTS(SELECT 1 FROM app.notice_delivery WHERE campaign_id=? AND status IN ('PREPARED','QUEUED','RETRY'))
            """, id, id);
    }
    private Notice notice(UUID id, boolean lock) {
        List<Notice> rows = jdbc.query("SELECT * FROM app.service_notice WHERE id=?" + (lock ? " FOR UPDATE" : ""), NOTICE, id);
        if (rows.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        return rows.getFirst();
    }
    private Campaign lockCampaign(UUID id) {
        List<UUID> rows = jdbc.query("SELECT id FROM app.notice_campaign WHERE id=? FOR UPDATE", (row,n) -> row.getObject(1, UUID.class), id);
        if (rows.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        return campaign(id);
    }
    private Campaign campaign(UUID id) {
        Map<String,Integer> counts = new LinkedHashMap<>();
        jdbc.query("SELECT status,COUNT(*) AS total FROM app.notice_delivery WHERE campaign_id=? GROUP BY status ORDER BY status",
            (org.springframework.jdbc.core.RowCallbackHandler) row -> counts.put(row.getString(1), row.getInt(2)), id);
        return jdbc.queryForObject("SELECT * FROM app.notice_campaign WHERE id=?", (row,n) -> new Campaign(id, row.getObject("notice_id",UUID.class),
            row.getString("snapshot_title"), row.getString("snapshot_body"), row.getString("snapshot_version_label"), row.getString("status"),
            row.getString("content_hash"), row.getString("recipient_hash"), row.getInt("recipient_count"), row.getString("test_status"),
            row.getTimestamp("created_at").toInstant(), Map.copyOf(counts)), id);
    }
    private void requireAdmin(UUID actor) {
        List<UUID> grants = jdbc.query("""
            SELECT grant_row.user_id FROM app.platform_admin_grant grant_row
            JOIN app.user_account account ON account.id=grant_row.user_id AND account.status='ACTIVE' AND account.email_verification_required=FALSE
            WHERE grant_row.user_id=? AND grant_row.capability='NOTICES_ADMIN' AND grant_row.revoked_at IS NULL
            FOR SHARE OF grant_row,account
            """, (row,n) -> row.getObject(1,UUID.class), actor);
        if (grants.isEmpty()) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Independent notice administrator capability required");
    }
    private void audit(UUID actor, UUID notice, UUID campaign, String action, String hash) {
        jdbc.update("INSERT INTO app.notice_admin_audit(id,actor_user_id,notice_id,campaign_id,action,content_hash) VALUES (?,?,?,?,?,?)",
            UUID.randomUUID(), actor, notice, campaign, action, hash);
    }
    private static String recipientHash(List<Recipient> recipients) {
        List<String> fields = new ArrayList<>();
        for (Recipient recipient : recipients) { fields.add(recipient.userId().toString()); fields.add(recipient.email()); }
        return NoticeIntegrity.hash(fields);
    }
    private static Instant instant(Timestamp time) { return time == null ? null : time.toInstant(); }
    private static ResponseStatusException bad(String message) { return new ResponseStatusException(HttpStatus.BAD_REQUEST,message); }
    private static ResponseStatusException conflict(String message) { return new ResponseStatusException(HttpStatus.CONFLICT,message); }
}
