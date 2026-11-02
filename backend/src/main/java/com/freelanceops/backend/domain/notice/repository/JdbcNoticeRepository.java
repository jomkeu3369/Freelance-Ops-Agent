package com.freelanceops.backend.domain.notice.repository;

import com.freelanceops.backend.domain.notice.dto.response.NoticeCampaignResponse;
import com.freelanceops.backend.domain.notice.dto.response.NoticeResponse;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Repository
public class JdbcNoticeRepository {
    private final JdbcTemplate jdbc;

    public JdbcNoticeRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    private static final RowMapper<NoticeResponse> NOTICE =
            (row, n) ->
                    new NoticeResponse(
                            row.getObject("id", UUID.class),
                            row.getString("kind"),
                            row.getString("title"),
                            row.getString("body"),
                            row.getString("version_label"),
                            row.getTimestamp("effective_at").toInstant(),
                            instant(row.getTimestamp("publish_at")),
                            row.getString("status"),
                            row.getString("content_hash"),
                            row.getLong("revision"));

    public record Recipient(UUID userId, String email) {}

    public record Delivery(UUID id, UUID userId, String email, int attempts) {}

    public List<NoticeResponse> listPublished(Instant instant) {
        return jdbc.query(
                "SELECT * FROM app.service_notice WHERE kind = 'OPERATIONAL' AND status = 'PUBLISHED' AND publish_at <= ? ORDER BY publish_at DESC LIMIT 100",
                NOTICE,
                Timestamp.from(instant));
    }

    public List<NoticeResponse> listNotices() {
        return jdbc.query(
                "SELECT * FROM app.service_notice ORDER BY created_at DESC LIMIT 100", NOTICE);
    }

    public List<UUID> listCampaignIds() {
        return jdbc.query(
                "SELECT id FROM app.notice_campaign ORDER BY created_at DESC LIMIT 100",
                (row, n) -> row.getObject(1, UUID.class));
    }

    public int insertNotice(
            UUID id,
            String kind,
            String title,
            String body,
            String versionLabel,
            Instant effectiveAt,
            String hash,
            UUID actor) {
        return jdbc.update(
                """
            INSERT INTO app.service_notice (id,kind,title,body,version_label,effective_at,status,content_hash,created_by)
            VALUES (?,?,?,?,?,?,'DRAFT',?,?)
            """,
                id,
                kind,
                title,
                body,
                versionLabel,
                Timestamp.from(effectiveAt),
                hash,
                actor);
    }

    public int markReviewed(UUID id) {
        return jdbc.update(
                "UPDATE app.service_notice SET status = 'REVIEWED', revision = revision + 1 WHERE id = ?",
                id);
    }

    public int publishNotice(Instant publishAt, UUID id) {
        return jdbc.update(
                "UPDATE app.service_notice SET status = 'PUBLISHED', publish_at = ?, revision = revision + 1 WHERE id = ?",
                Timestamp.from(publishAt),
                id);
    }

    public List<Integer> lockCampaignPreparation(String actor) {
        return jdbc.query(
                "SELECT pg_advisory_xact_lock(hashtextextended(?, 0))", (row, n) -> 0, actor);
    }

    public Integer countRecentCampaigns(UUID actor, Instant createdAfter) {
        return jdbc.queryForObject(
                "SELECT COUNT(*) FROM app.notice_campaign WHERE created_by = ? AND created_at > ?",
                Integer.class,
                actor,
                Timestamp.from(createdAfter));
    }

    public List<Recipient> listRecipients(int maxRecipients) {
        return jdbc.query(
                """
            SELECT id,email FROM app.user_account WHERE status = 'ACTIVE' AND email_verified_at IS NOT NULL
            AND email_verification_required = FALSE ORDER BY id LIMIT ? FOR SHARE
            """,
                (row, n) -> new Recipient(row.getObject(1, UUID.class), row.getString(2)),
                maxRecipients);
    }

    public int insertCampaign(
            UUID id,
            UUID noticeId,
            String title,
            String body,
            String versionLabel,
            String contentHash,
            String recipientHash,
            int recipientCount,
            UUID actor,
            Instant createdAt) {
        return jdbc.update(
                """
            INSERT INTO app.notice_campaign(id,notice_id,snapshot_title,snapshot_body,snapshot_version_label,content_hash,
              recipient_hash,recipient_count,status,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,'DRAFT',?,?)
            """,
                id,
                noticeId,
                title,
                body,
                versionLabel,
                contentHash,
                recipientHash,
                recipientCount,
                actor,
                Timestamp.from(createdAt));
    }

    public int insertDelivery(UUID id, UUID campaignId, UUID userId, String email) {
        return jdbc.update(
                """
            INSERT INTO app.notice_delivery(id,campaign_id,user_id,recipient_email,status) VALUES (?,?,?,?,'PREPARED')
            """,
                id,
                campaignId,
                userId,
                email);
    }

    public List<String> findVerifiedEmail(UUID actor) {
        return jdbc.query(
                "SELECT email FROM app.user_account WHERE id = ? AND status = 'ACTIVE' AND email_verified_at IS NOT NULL AND email_verification_required = FALSE FOR SHARE",
                (row, n) -> row.getString(1),
                actor);
    }

    public record TestState(Instant testedAt, int count) {}

    public TestState readTestState(UUID id) {
        Map<String, Object> row =
                jdbc.queryForMap(
                        "SELECT tested_at,test_count FROM app.notice_campaign WHERE id = ?", id);
        Timestamp testedAt = (Timestamp) row.get("tested_at");
        return new TestState(instant(testedAt), ((Number) row.get("test_count")).intValue());
    }

    public int updateTestState(String result, UUID actor, Instant instant, UUID id) {
        return jdbc.update(
                "UPDATE app.notice_campaign SET test_status=?,test_by=?,tested_at=?,test_count=test_count+1 WHERE id=?",
                result,
                actor,
                Timestamp.from(instant),
                id);
    }

    public UUID findTester(UUID id) {
        return jdbc.queryForObject(
                "SELECT test_by FROM app.notice_campaign WHERE id=?", UUID.class, id);
    }

    public List<Recipient> listDeliveryRecipients(UUID id) {
        return jdbc.query(
                "SELECT user_id,recipient_email FROM app.notice_delivery WHERE campaign_id=? ORDER BY user_id",
                (row, n) -> new Recipient(row.getObject(1, UUID.class), row.getString(2)),
                id);
    }

    public int queueCampaign(UUID actor, Instant instant, UUID id) {
        return jdbc.update(
                "UPDATE app.notice_campaign SET status='QUEUED',confirmed_by=?,confirmed_at=? WHERE id=?",
                actor,
                Timestamp.from(instant),
                id);
    }

    public int queueDeliveries(Instant nextAttemptAt, Instant updatedAt, UUID id) {
        return jdbc.update(
                "UPDATE app.notice_delivery SET status='QUEUED',next_attempt_at=?,updated_at=? WHERE campaign_id=? AND status='PREPARED'",
                Timestamp.from(nextAttemptAt),
                Timestamp.from(updatedAt),
                id);
    }

    public int cancelCampaign(Instant instant, UUID id) {
        return jdbc.update(
                "UPDATE app.notice_campaign SET status='CANCELLED',cancelled_at=? WHERE id=?",
                Timestamp.from(instant),
                id);
    }

    public int cancelDeliveries(Instant instant, UUID id) {
        return jdbc.update(
                "UPDATE app.notice_delivery SET status='CANCELLED',updated_at=? WHERE campaign_id=? AND status IN ('PREPARED','QUEUED','RETRY')",
                Timestamp.from(instant),
                id);
    }

    public List<Delivery> findDueDeliveries(UUID id, Instant instant) {
        return jdbc.query(
                """
            SELECT id,user_id,recipient_email,attempts FROM app.notice_delivery WHERE campaign_id=? AND status IN ('QUEUED','RETRY')
            AND next_attempt_at <= ? ORDER BY next_attempt_at,id LIMIT 1 FOR UPDATE SKIP LOCKED
            """,
                (row, n) ->
                        new Delivery(
                                row.getObject(1, UUID.class),
                                row.getObject(2, UUID.class),
                                row.getString(3),
                                row.getInt(4)),
                id,
                Timestamp.from(instant));
    }

    public List<UUID> findEligibleRecipient(UUID userId, String email) {
        return jdbc.query(
                """
            SELECT id FROM app.user_account WHERE id=? AND email=? AND status='ACTIVE' AND email_verified_at IS NOT NULL
            AND email_verification_required=FALSE FOR SHARE
            """,
                (row, n) -> row.getObject(1, UUID.class),
                userId,
                email);
    }

    public int suppressDelivery(Instant instant, UUID id) {
        return jdbc.update(
                "UPDATE app.notice_delivery SET status='SUPPRESSED',last_result='INELIGIBLE',updated_at=? WHERE id=?",
                Timestamp.from(instant),
                id);
    }

    public int recordDelivery(
            String state, int attempts, String result, Instant next, Instant instant, UUID id) {
        return jdbc.update(
                "UPDATE app.notice_delivery SET status=?,attempts=?,last_result=?,next_attempt_at=?,updated_at=? WHERE id=?",
                state,
                attempts,
                result,
                Timestamp.from(next),
                Timestamp.from(instant),
                id);
    }

    public int completeCampaign(UUID id) {
        return jdbc.update(
                """
            UPDATE app.notice_campaign SET status='COMPLETED' WHERE id=? AND status='QUEUED'
            AND NOT EXISTS(SELECT 1 FROM app.notice_delivery WHERE campaign_id=? AND status IN ('PREPARED','QUEUED','RETRY'))
            """,
                id,
                id);
    }

    public List<NoticeResponse> findNotice(UUID id, boolean lock) {
        return jdbc.query(
                "SELECT * FROM app.service_notice WHERE id=?" + (lock ? " FOR UPDATE" : ""),
                NOTICE,
                id);
    }

    public List<UUID> lockCampaign(UUID id) {
        return jdbc.query(
                "SELECT id FROM app.notice_campaign WHERE id=? FOR UPDATE",
                (row, n) -> row.getObject(1, UUID.class),
                id);
    }

    public void collectDeliveryCounts(UUID id, Map<String, Integer> counts) {
        jdbc.query(
                "SELECT status,COUNT(*) AS total FROM app.notice_delivery WHERE campaign_id=? GROUP BY status ORDER BY status",
                (org.springframework.jdbc.core.RowCallbackHandler)
                        row -> counts.put(row.getString(1), row.getInt(2)),
                id);
    }

    public NoticeCampaignResponse findCampaign(UUID id, Map<String, Integer> counts) {
        return jdbc.queryForObject(
                "SELECT * FROM app.notice_campaign WHERE id=?",
                (row, n) ->
                        new NoticeCampaignResponse(
                                id,
                                row.getObject("notice_id", UUID.class),
                                row.getString("snapshot_title"),
                                row.getString("snapshot_body"),
                                row.getString("snapshot_version_label"),
                                row.getString("status"),
                                row.getString("content_hash"),
                                row.getString("recipient_hash"),
                                row.getInt("recipient_count"),
                                row.getString("test_status"),
                                row.getTimestamp("created_at").toInstant(),
                                Map.copyOf(counts)),
                id);
    }

    public List<UUID> findAdminGrant(UUID actor) {
        return jdbc.query(
                """
            SELECT grant_row.user_id FROM app.platform_admin_grant grant_row
            JOIN app.user_account account ON account.id=grant_row.user_id AND account.status='ACTIVE' AND account.email_verification_required=FALSE
            WHERE grant_row.user_id=? AND grant_row.capability='NOTICES_ADMIN' AND grant_row.revoked_at IS NULL
            FOR SHARE OF grant_row,account
            """,
                (row, n) -> row.getObject(1, UUID.class),
                actor);
    }

    public int insertAudit(
            UUID id, UUID actor, UUID notice, UUID campaign, String action, String hash) {
        return jdbc.update(
                "INSERT INTO app.notice_admin_audit(id,actor_user_id,notice_id,campaign_id,action,content_hash) VALUES (?,?,?,?,?,?)",
                id,
                actor,
                notice,
                campaign,
                action,
                hash);
    }

    private static Instant instant(Timestamp time) {
        return time == null ? null : time.toInstant();
    }
}
