package com.freelanceops.backend.domain.agentrun.repository;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.*;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Repository
public class JdbcChatAttachmentRepository {
    private final JdbcTemplate jdbc;

    public JdbcChatAttachmentRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public List<Map<String, Object>> lockOwner(UUID user) {
        return jdbc.queryForList("SELECT id FROM app.user_account WHERE id = ? FOR UPDATE", user);
    }

    public int deleteExpiredForOwner(UUID user) {
        return jdbc.update(
                "DELETE FROM app.chat_attachment WHERE owner_id = ? AND expires_at <= CURRENT_TIMESTAMP",
                user);
    }

    public Integer countForOwner(UUID user) {
        return jdbc.queryForObject(
                "SELECT count(*) FROM app.chat_attachment WHERE owner_id = ?", Integer.class, user);
    }

    public int insertAttachment(
            UUID id, UUID workspace, UUID project, UUID user, String payload, Instant expires) {
        return jdbc.update(
                "INSERT INTO app.chat_attachment(id, workspace_id, project_id, owner_id, payload, expires_at) VALUES (?, ?, ?, ?, ?::jsonb, ?)",
                id,
                workspace,
                project,
                user,
                payload,
                Timestamp.from(expires));
    }

    public int deleteAttachment(UUID id, UUID workspace, UUID project, UUID user) {
        return jdbc.update(
                "DELETE FROM app.chat_attachment WHERE id = ? AND workspace_id = ? AND project_id = ? AND owner_id = ?",
                id,
                workspace,
                project,
                user);
    }

    public List<String> findPayload(UUID id, UUID workspace, UUID project, UUID user) {
        return jdbc.queryForList(
                "SELECT payload::text FROM app.chat_attachment WHERE id = ? AND workspace_id = ? AND project_id = ? AND owner_id = ? AND expires_at > CURRENT_TIMESTAMP",
                String.class,
                id,
                workspace,
                project,
                user);
    }

    public int consumeAttachment(UUID id, UUID workspace, UUID project, UUID user) {
        return jdbc.update(
                "DELETE FROM app.chat_attachment WHERE id = ? AND workspace_id = ? AND project_id = ? AND owner_id = ?",
                id,
                workspace,
                project,
                user);
    }

    public int deleteExpired() {
        return jdbc.update("DELETE FROM app.chat_attachment WHERE expires_at <= CURRENT_TIMESTAMP");
    }
}
