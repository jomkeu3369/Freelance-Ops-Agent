package com.freelanceops.backend.domain.identity.service;

import com.freelanceops.backend.domain.identity.dto.response.AdminMemberResponse.*;
import com.freelanceops.backend.domain.agentrun.service.PlatformUsageService;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/** Platform metadata only. This service cannot load tenant content or change accounts. */
@Service
public class AdminMemberService {
    private final JdbcTemplate jdbc;
    private final PlatformUsageService usage;
    public AdminMemberService(JdbcTemplate jdbc, PlatformUsageService usage) {
        this.jdbc = jdbc; this.usage = usage;
    }
    private static final String MEMBER_COLUMNS = """
        a.id, a.email, a.display_name, a.status, a.email_verification_required, a.email_verified_at, a.created_at,
        (SELECT max(e.occurred_at) FROM app.user_login_event e WHERE e.user_id=a.id) AS last_login_at
        """;
    // PLATFORM_SPEND uses revisions in the legacy epoch-shaped response fields; it has no reset generation.
    private static final String AUDIT = """
        (SELECT id, 'WEEKLY_CREDITS' AS source, actor_user_id, action, target, previous_value, new_value,
                previous_epoch, new_epoch, created_at FROM app.weekly_credit_admin_audit
         UNION ALL
         SELECT id, 'LEGACY_MONTHLY' AS source, actor_user_id, action,
                CASE WHEN action='RESET_ALL' THEN 'epoch' ELSE 'monthly_limit' END AS target,
                CASE WHEN action='RESET_ALL' THEN previous_epoch::text ELSE previous_limit::text END AS previous_value,
                CASE WHEN action='RESET_ALL' THEN new_epoch::text ELSE new_limit::text END AS new_value,
                previous_epoch, new_epoch, created_at FROM app.free_usage_admin_audit
         UNION ALL
         SELECT id, 'PLATFORM_SPEND' AS source, actor_user_id, action, target, previous_value, new_value,
                previous_revision AS previous_epoch, new_revision AS new_epoch, created_at
         FROM app.platform_spend_admin_audit) audit
        """;

    @Transactional
    public Page<Member> members(UUID actor, String query, String status, int page, int size) {
        requireAdmin(actor);
        validatePage(page, size);
        String q = query == null ? "" : query.strip();
        if (q.length() > 100) throw badRequest("Search is limited to 100 characters");
        String filter = status == null ? "" : status;
        if (!Set.of("", "ACTIVE", "DISABLED", "PENDING_VERIFICATION").contains(filter))
            throw badRequest("Unsupported account status");
        List<Object> params = new ArrayList<>();
        StringBuilder where = new StringBuilder(" WHERE 1=1");
        if (!q.isEmpty()) {
            where.append(" AND (a.email ILIKE ? ESCAPE '!' OR a.display_name ILIKE ? ESCAPE '!' OR a.id::text = ?)");
            String pattern = "%" + q.replace("!", "!!").replace("%", "!%").replace("_", "!_") + "%";
            params.add(pattern); params.add(pattern); params.add(q);
        }
        if (filter.equals("PENDING_VERIFICATION")) where.append(" AND a.email_verification_required=TRUE");
        else if (!filter.isEmpty()) { where.append(" AND a.status=?"); params.add(filter); }
        long total = jdbc.queryForObject("SELECT count(*) FROM app.user_account a" + where, Long.class, params.toArray());
        params.add(size); params.add((long) page * size);
        var items = jdbc.query("SELECT " + MEMBER_COLUMNS + " FROM app.user_account a" + where
            + " ORDER BY a.created_at DESC, a.id DESC LIMIT ? OFFSET ?", (row, n) -> member(row), params.toArray());
        return new Page<>(items, total, page, size, recordingStartedAt());
    }

    @Transactional
    public Member member(UUID actor, UUID userId) {
        requireAdmin(actor);
        return jdbc.query("SELECT " + MEMBER_COLUMNS + " FROM app.user_account a WHERE a.id=?",
            (row, n) -> member(row), userId).stream().findFirst()
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
    }

    @Transactional
    public PlatformUsageService.Usage usage(UUID actor, UUID userId) {
        requireAdmin(actor);
        requireMember(userId);
        return usage.snapshot(userId);
    }

    @Transactional
    public PlatformUsageService.History usageHistory(UUID actor, UUID userId, String cursor, int limit) {
        requireAdmin(actor);
        if (limit < 1 || limit > 100 || (cursor != null && cursor.length() > 256))
            throw badRequest("Invalid usage limit or cursor");
        requireMember(userId);
        return usage.history(userId, cursor, limit);
    }

    // Disabled/unverified target accounts remain auditable. The requesting admin must be
    // active and verified; locking the target also serializes deletion with the ledger read.
    private void requireMember(UUID userId) {
        if (jdbc.query("SELECT id FROM app.user_account WHERE id=? FOR SHARE",
                (row, n) -> row.getObject(1, UUID.class), userId).isEmpty())
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
    }

    @Transactional
    public Summary summary(UUID actor) {
        requireAdmin(actor);
        return jdbc.queryForObject("""
            SELECT count(*) AS total, count(*) FILTER (WHERE status='ACTIVE' AND NOT email_verification_required) AS active,
                count(*) FILTER (WHERE email_verification_required) AS pending,
                count(*) FILTER (WHERE created_at >= CURRENT_TIMESTAMP - INTERVAL '7 days') AS joined,
                (SELECT count(DISTINCT user_id) FROM app.user_login_event
                 WHERE occurred_at >= CURRENT_TIMESTAMP - INTERVAL '7 days') AS signed_in
            FROM app.user_account
            """, (row, n) -> new Summary(row.getLong("total"), row.getLong("active"), row.getLong("pending"),
            row.getLong("joined"), row.getLong("signed_in"), recordingStartedAt()));
    }

    @Transactional
    public Page<Login> logins(UUID actor, UUID userId, int page, int size) {
        requireAdmin(actor);
        validatePage(page, size);
        String where = userId == null ? "" : " WHERE user_id=?";
        Object[] args = userId == null ? new Object[0] : new Object[]{userId};
        long total = jdbc.queryForObject("SELECT count(*) FROM app.user_login_event" + where, Long.class, args);
        List<Object> pageArgs = new ArrayList<>(List.of(args));
        pageArgs.add(size); pageArgs.add((long) page * size);
        var rows = jdbc.query("SELECT id,user_id,method,occurred_at FROM app.user_login_event" + where
            + " ORDER BY occurred_at DESC,id DESC LIMIT ? OFFSET ?", (row, n) -> new Login(
            row.getObject("id", UUID.class), row.getObject("user_id", UUID.class), row.getString("method"),
            instant(row, "occurred_at")), pageArgs.toArray());
        return new Page<>(rows, total, page, size, recordingStartedAt());
    }

    @Transactional
    public Page<Audit> audits(UUID actor, int page, int size) {
        requireAdmin(actor);
        validatePage(page, size);
        long total = jdbc.queryForObject("SELECT count(*) FROM " + AUDIT, Long.class);
        var rows = jdbc.query("SELECT * FROM " + AUDIT + " ORDER BY created_at DESC,source,id DESC LIMIT ? OFFSET ?",
            (row, n) -> new Audit(row.getObject("id", UUID.class), row.getString("source"),
                row.getObject("actor_user_id", UUID.class), row.getString("action"), row.getString("target"),
                row.getString("previous_value"), row.getString("new_value"), row.getLong("previous_epoch"),
                row.getLong("new_epoch"), instant(row, "created_at")), size, (long) page * size);
        return new Page<>(rows, total, page, size, null);
    }

    // Grant and active account are rechecked on every call; JWT/workspace role claims never suffice.
    // Locks survive to transaction completion to serialize revocation with the protected read.
    private void requireAdmin(UUID actor) {
        var granted = jdbc.query("""
            SELECT g.user_id FROM app.platform_admin_grant g
            JOIN app.user_account a ON a.id=g.user_id AND a.status='ACTIVE' AND NOT a.email_verification_required
            WHERE g.user_id=? AND g.capability='MEMBERS_READ' AND g.revoked_at IS NULL
            FOR SHARE OF g,a
            """, (row, n) -> row.getObject(1, UUID.class), actor);
        if (granted.isEmpty()) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Member administration capability required");
    }
    private Instant recordingStartedAt() {
        return jdbc.queryForObject("SELECT recording_started_at FROM app.login_activity_metadata WHERE id=1",
            (row, n) -> instant(row, "recording_started_at"));
    }
    private static Member member(ResultSet row) throws SQLException {
        return new Member(row.getObject("id", UUID.class), row.getString("email"), row.getString("display_name"),
            row.getString("status"), row.getBoolean("email_verification_required"), instant(row, "email_verified_at"),
            instant(row, "created_at"), instant(row, "last_login_at"));
    }
    private static Instant instant(ResultSet row, String column) throws SQLException {
        var value = row.getTimestamp(column); return value == null ? null : value.toInstant();
    }
    private static void validatePage(int page, int size) {
        if (page < 0 || page > 100000 || size < 1 || size > 100) throw badRequest("Invalid page or size");
    }
    private static ResponseStatusException badRequest(String message) { return new ResponseStatusException(HttpStatus.BAD_REQUEST, message); }
}
