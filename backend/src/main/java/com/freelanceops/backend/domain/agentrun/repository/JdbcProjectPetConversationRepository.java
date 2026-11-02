package com.freelanceops.backend.domain.agentrun.repository;

import com.freelanceops.backend.domain.agentrun.dto.PetConversation;
import com.freelanceops.backend.domain.agentrun.dto.PetConversation.Turn;
import com.freelanceops.backend.domain.agentrun.dto.response.AgentRunView;
import com.freelanceops.backend.domain.agentrun.dto.response.ProjectPetConversationResponse;
import com.freelanceops.backend.domain.agentrun.dto.response.ProjectPetConversationSettingsResponse;

import jakarta.validation.constraints.*;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import tools.jackson.databind.ObjectMapper;

import java.util.*;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Repository
public class JdbcProjectPetConversationRepository {
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;

    public JdbcProjectPetConversationRepository(JdbcTemplate jdbc, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.mapper = mapper;
    }

    public List<ProjectPetConversationResponse> findConversation(
            UUID workspace, UUID project, UUID user) {
        return jdbc.query(
                "SELECT settings_json::text, version FROM app.project_pet_conversation"
                        + " WHERE workspace_id = ? AND project_id = ? AND user_id = ?",
                (row, index) ->
                        new ProjectPetConversationResponse(
                                mapper.readValue(
                                        row.getString(1),
                                        ProjectPetConversationSettingsResponse.class),
                                row.getLong(2)),
                workspace,
                project,
                user);
    }

    public List<Turn> listTurns(UUID workspace, UUID project, UUID user, boolean canReadQuotes) {
        return jdbc.query(
                "SELECT user_text, messages_json::text FROM app.project_pet_turn"
                        + " WHERE workspace_id = ? AND project_id = ? AND user_id = ? ORDER BY created_at DESC, run_id DESC LIMIT 6",
                (row, index) ->
                        new PetConversation.Turn(
                                row.getString(1),
                                canReadQuotes
                                        ? List.of(
                                                mapper.readValue(
                                                        row.getString(2),
                                                        AgentRunView.PetMessage[].class))
                                        : List.of()),
                workspace,
                project,
                user);
    }

    public List<Map<String, Object>> listRateCards(UUID workspace) {
        return jdbc.queryForList(
                "SELECT id, name, unit, rate, currency FROM app.rate_card"
                        + " WHERE workspace_id = ? AND active = true ORDER BY name, id LIMIT 100",
                workspace);
    }

    public int insertTurn(UUID run, UUID workspace, UUID project, UUID user, String text) {
        return jdbc.update(
                "INSERT INTO app.project_pet_turn(run_id, workspace_id, project_id, user_id, user_text)"
                        + " VALUES (?, ?, ?, ?, ?)",
                run,
                workspace,
                project,
                user,
                text);
    }

    public int recordMessages(String payload, UUID id, int size) {
        return jdbc.update(
                "UPDATE app.project_pet_turn SET messages_json = ?::jsonb WHERE run_id = ?"
                        + " AND jsonb_array_length(messages_json) <= ?",
                payload,
                id,
                size);
    }

    public int upsertConversation(
            UUID workspace, UUID project, UUID user, String payload, long version) {
        return jdbc.update(
                "INSERT INTO app.project_pet_conversation(workspace_id, project_id, user_id, settings_json, version)"
                        + " VALUES (?, ?, ?, ?::jsonb, ?) ON CONFLICT (workspace_id, project_id, user_id)"
                        + " DO UPDATE SET settings_json = EXCLUDED.settings_json, version = EXCLUDED.version",
                workspace,
                project,
                user,
                payload,
                version);
    }

    public Integer countActiveRuns(UUID project, UUID workspace) {
        return jdbc.queryForObject(
                "SELECT count(*) FROM app.agent_run WHERE project_id = ? AND workspace_id = ?"
                        + " AND status IN ('QUEUED', 'RUNNING', 'WAITING_FOR_USER')",
                Integer.class,
                project,
                workspace);
    }
}
