package com.freelanceops.backend.domain.identity.repository;

import com.freelanceops.backend.domain.identity.dto.response.AdminMemberAuditResponse;
import com.freelanceops.backend.domain.identity.dto.response.AdminMemberLoginResponse;
import com.freelanceops.backend.domain.identity.dto.response.AdminMemberResponse;
import com.freelanceops.backend.domain.identity.dto.response.AdminMemberSummaryResponse;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Repository
public class JdbcAdminMemberRepository {
    private final JdbcTemplate jdbc;

    public JdbcAdminMemberRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    private static final String MEMBER_COLUMNS =
            """
    a.id, a.email, a.display_name, a.status, a.email_verification_required, a.email_verified_at, a.created_at,
    (SELECT max(e.occurred_at) FROM app.user_login_event e WHERE e.user_id=a.id) AS last_login_at
    """;

    private static final String AUDIT =
            """
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

    public Long countMembers(String query, String status) {
        MemberFilter filter = memberFilter(query, status);
        return jdbc.queryForObject(
                "SELECT count(*) FROM app.user_account a" + filter.where(),
                Long.class,
                filter.bindings().toArray());
    }

    public List<AdminMemberResponse> listMembers(String query, String status, int page, int size) {
        MemberFilter filter = memberFilter(query, status);
        List<Object> bindings = new ArrayList<>(filter.bindings());
        bindings.add(size);
        bindings.add((long) page * size);
        return jdbc.query(
                "SELECT "
                        + MEMBER_COLUMNS
                        + " FROM app.user_account a"
                        + filter.where()
                        + " ORDER BY a.created_at DESC, a.id DESC LIMIT ? OFFSET ?",
                (row, n) -> member(row),
                bindings.toArray());
    }

    public List<AdminMemberResponse> findMember(UUID userId) {
        return jdbc.query(
                "SELECT " + MEMBER_COLUMNS + " FROM app.user_account a WHERE a.id=?",
                (row, n) -> member(row),
                userId);
    }

    public List<UUID> lockMember(UUID userId) {
        return jdbc.query(
                "SELECT id FROM app.user_account WHERE id=? FOR SHARE",
                (row, n) -> row.getObject(1, UUID.class),
                userId);
    }

    public AdminMemberSummaryResponse readSummary() {
        return jdbc.queryForObject(
                """
            SELECT count(*) AS total, count(*) FILTER (WHERE status='ACTIVE' AND NOT email_verification_required) AS active,
                count(*) FILTER (WHERE email_verification_required) AS pending,
                count(*) FILTER (WHERE created_at >= CURRENT_TIMESTAMP - INTERVAL '7 days') AS joined,
                (SELECT count(DISTINCT user_id) FROM app.user_login_event
                 WHERE occurred_at >= CURRENT_TIMESTAMP - INTERVAL '7 days') AS signed_in
            FROM app.user_account
            """,
                (row, n) ->
                        new AdminMemberSummaryResponse(
                                row.getLong("total"),
                                row.getLong("active"),
                                row.getLong("pending"),
                                row.getLong("joined"),
                                row.getLong("signed_in"),
                                recordingStartedAt()));
    }

    public Long countLogins(UUID userId) {
        String where = userId == null ? "" : " WHERE user_id=?";
        Object[] args = userId == null ? new Object[0] : new Object[] {userId};
        return jdbc.queryForObject(
                "SELECT count(*) FROM app.user_login_event" + where, Long.class, args);
    }

    public List<AdminMemberLoginResponse> listLogins(UUID userId, int page, int size) {
        String where = userId == null ? "" : " WHERE user_id=?";
        Object[] args = userId == null ? new Object[0] : new Object[] {userId};
        List<Object> bindings = new ArrayList<>(List.of(args));
        bindings.add(size);
        bindings.add((long) page * size);
        return jdbc.query(
                "SELECT id,user_id,method,occurred_at FROM app.user_login_event"
                        + where
                        + " ORDER BY occurred_at DESC,id DESC LIMIT ? OFFSET ?",
                (row, n) ->
                        new AdminMemberLoginResponse(
                                row.getObject("id", UUID.class),
                                row.getObject("user_id", UUID.class),
                                row.getString("method"),
                                instant(row, "occurred_at")),
                bindings.toArray());
    }

    public Long countAudits() {
        return jdbc.queryForObject("SELECT count(*) FROM " + AUDIT, Long.class);
    }

    public List<AdminMemberAuditResponse> listAudits(int size, long offset) {
        return jdbc.query(
                "SELECT * FROM "
                        + AUDIT
                        + " ORDER BY created_at DESC,source,id DESC LIMIT ? OFFSET ?",
                (row, n) ->
                        new AdminMemberAuditResponse(
                                row.getObject("id", UUID.class),
                                row.getString("source"),
                                row.getObject("actor_user_id", UUID.class),
                                row.getString("action"),
                                row.getString("target"),
                                row.getString("previous_value"),
                                row.getString("new_value"),
                                row.getLong("previous_epoch"),
                                row.getLong("new_epoch"),
                                instant(row, "created_at")),
                size,
                offset);
    }

    public List<UUID> findAdminGrant(UUID actor) {
        return jdbc.query(
                """
            SELECT g.user_id FROM app.platform_admin_grant g
            JOIN app.user_account a ON a.id=g.user_id AND a.status='ACTIVE' AND NOT a.email_verification_required
            WHERE g.user_id=? AND g.capability='MEMBERS_READ' AND g.revoked_at IS NULL
            FOR SHARE OF g,a
            """,
                (row, n) -> row.getObject(1, UUID.class),
                actor);
    }

    public Instant recordingStartedAt() {
        return jdbc.queryForObject(
                "SELECT recording_started_at FROM app.login_activity_metadata WHERE id=1",
                (row, n) -> instant(row, "recording_started_at"));
    }

    private static AdminMemberResponse member(ResultSet row) throws SQLException {
        return new AdminMemberResponse(
                row.getObject("id", UUID.class),
                row.getString("email"),
                row.getString("display_name"),
                row.getString("status"),
                row.getBoolean("email_verification_required"),
                instant(row, "email_verified_at"),
                instant(row, "created_at"),
                instant(row, "last_login_at"));
    }

    private static Instant instant(ResultSet row, String column) throws SQLException {
        var value = row.getTimestamp(column);
        return value == null ? null : value.toInstant();
    }

    private record MemberFilter(String where, List<Object> bindings) {}

    private static MemberFilter memberFilter(String query, String status) {
        List<Object> params = new ArrayList<>();
        StringBuilder where = new StringBuilder(" WHERE 1=1");
        if (!query.isEmpty()) {
            where.append(
                    " AND (a.email ILIKE ? ESCAPE '!' OR a.display_name ILIKE ? ESCAPE '!' OR a.id::text = ?)");
            String pattern =
                    "%" + query.replace("!", "!!").replace("%", "!%").replace("_", "!_") + "%";
            params.add(pattern);
            params.add(pattern);
            params.add(query);
        }
        if (status.equals("PENDING_VERIFICATION"))
            where.append(" AND a.email_verification_required=TRUE");
        else if (!status.isEmpty()) {
            where.append(" AND a.status=?");
            params.add(status);
        }
        return new MemberFilter(where.toString(), params);
    }
}
