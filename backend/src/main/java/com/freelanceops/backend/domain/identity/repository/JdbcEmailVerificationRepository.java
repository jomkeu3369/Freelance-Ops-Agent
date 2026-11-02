package com.freelanceops.backend.domain.identity.repository;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.Date;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

@Repository
public class JdbcEmailVerificationRepository {
    private final JdbcTemplate jdbc;

    public JdbcEmailVerificationRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public record PendingAccount(
            UUID id, String email, Instant lastRequest, LocalDate day, int count) {}

    public int insertPendingAccount(
            UUID id, String externalSubject, String email, String displayName, Instant now) {
        return jdbc.update(
                """
            INSERT INTO app.user_account (id, external_subject, email, display_name, password_hash, status,
                created_at, updated_at, version, email_verification_required)
            VALUES (?, ?, ?, ?, NULL, 'ACTIVE', ?, ?, 0, TRUE) ON CONFLICT DO NOTHING
            """,
                id,
                externalSubject,
                email,
                displayName,
                Timestamp.from(now),
                Timestamp.from(now));
    }

    public List<PendingAccount> findPendingAccount(String email) {
        return jdbc.query(
                """
            SELECT id, email, email_verification_requested_at, email_verification_day, email_verification_daily_count
            FROM app.user_account WHERE LOWER(email) = ? AND status = 'ACTIVE' AND email_verified_at IS NULL FOR UPDATE
            """,
                (row, n) ->
                        new PendingAccount(
                                row.getObject(1, UUID.class),
                                row.getString(2),
                                instant(row.getTimestamp(3)),
                                localDate(row.getDate(4)),
                                row.getInt(5)),
                email);
    }

    public int updateVerification(
            String tokenHash, Instant expiresAt, Instant now, LocalDate day, int count, UUID id) {
        return jdbc.update(
                """
            UPDATE app.user_account SET email_verification_token_hash = ?, email_verification_expires_at = ?,
            email_verification_requested_at = ?, email_verification_day = ?, email_verification_daily_count = ?,
            updated_at = ?, version = version + 1 WHERE id = ?
            """,
                tokenHash,
                Timestamp.from(expiresAt),
                Timestamp.from(now),
                Date.valueOf(day),
                count,
                Timestamp.from(now),
                id);
    }

    public int confirmAccount(Instant now, String passwordHash, String tokenHash) {
        return jdbc.update(
                """
            UPDATE app.user_account SET email_verified_at = ?,
                password_hash = CASE WHEN email_verification_required THEN ? ELSE password_hash END, email_verification_required = FALSE,
                email_verification_token_hash = NULL, email_verification_expires_at = NULL, updated_at = ?, version = version + 1
            WHERE email_verification_token_hash = ? AND email_verification_expires_at > ? AND status = 'ACTIVE'
                AND email_verified_at IS NULL
            """,
                Timestamp.from(now),
                passwordHash,
                Timestamp.from(now),
                tokenHash,
                Timestamp.from(now));
    }

    private static Instant instant(Timestamp value) {
        return value == null ? null : value.toInstant();
    }

    private static LocalDate localDate(Date value) {
        return value == null ? null : value.toLocalDate();
    }
}
