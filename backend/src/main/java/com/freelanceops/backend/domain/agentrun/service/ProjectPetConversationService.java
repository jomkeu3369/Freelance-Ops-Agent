package com.freelanceops.backend.domain.agentrun.service;

import com.freelanceops.backend.domain.agentrun.dto.PetConversation;
import com.freelanceops.backend.domain.agentrun.dto.PetProfile;
import com.freelanceops.backend.domain.agentrun.dto.response.AgentRunView;
import com.freelanceops.backend.domain.agentrun.entity.AgentRunEntity;
import com.freelanceops.backend.domain.project.repository.ProjectRepository;
import com.freelanceops.backend.domain.workspace.policy.PermissionCode;
import com.freelanceops.backend.domain.workspace.repository.WorkspacePermissionReader;
import jakarta.validation.constraints.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.ObjectMapper;
import java.util.*;

@Service
public class ProjectPetConversationService {
    public record Settings(boolean petMode, boolean debateEnabled,
            List<UUID> participantPetIds, AgentRunView.QuotationDraft acceptedDraft, UUID draftSourceRunId) {}
    public record View(Settings settings, long version) {}
    public record Update(boolean petMode, boolean debateEnabled,
            @NotNull @Size(max = 3) List<@NotNull UUID> participantPetIds, @Min(0) long expectedVersion) {}
    public record Accept(@NotNull UUID runId, @Min(0) long expectedVersion) {}
    public record Snapshot(List<PetProfile> profiles, PetConversation context) {}

    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;
    private final CustomAgentPetService pets;
    private final WorkspacePermissionReader permissions;
    private final ProjectRepository projects;

    public ProjectPetConversationService(JdbcTemplate jdbc, ObjectMapper mapper,
            CustomAgentPetService pets, WorkspacePermissionReader permissions, ProjectRepository projects) {
        this.jdbc = jdbc; this.mapper = mapper; this.pets = pets;
        this.permissions = permissions; this.projects = projects;
    }

    public View get(UUID user, UUID workspace, UUID project) {
        authorize(user, workspace, project);
        var current = load(user, workspace, project);
        return visible(user, workspace, current);
    }

    private View visible(UUID user, UUID workspace, View current) {
        var membership = permissions.findActiveMembership(user, workspace).orElseThrow(() -> notFound());
        if (membership.permissions().contains(PermissionCode.QUOTATION_READ)) return current;
        var settings = current.settings();
        return new View(new Settings(settings.petMode(), settings.debateEnabled(),
                settings.participantPetIds(), null, null), current.version());
    }

    private View load(UUID user, UUID workspace, UUID project) {
        var rows = jdbc.query("SELECT settings_json::text, version FROM app.project_pet_conversation"
                + " WHERE workspace_id = ? AND project_id = ? AND user_id = ?",
                (row, index) -> new View(mapper.readValue(row.getString(1), Settings.class), row.getLong(2)),
                workspace, project, user);
        if (!rows.isEmpty()) return rows.getFirst();
        var collection = pets.list(user, workspace);
        var selected = collection.pets().stream().filter(p -> !p.archived()
                && p.id().equals(collection.selectedPetId())).map(CustomAgentPetService.Pet::id).toList();
        return new View(new Settings(!selected.isEmpty(), true, selected, null, null), 0);
    }

    @Transactional
    public View update(UUID user, UUID workspace, UUID project, Update input) {
        authorize(user, workspace, project);
        lock(project, workspace);
        var current = load(user, workspace, project);
        checkVersion(current, input.expectedVersion());
        if (input.participantPetIds() == null || input.participantPetIds().size() > 3
                || new HashSet<>(input.participantPetIds()).size() != input.participantPetIds().size()
                || input.petMode() && input.participantPetIds().isEmpty()) throw invalid();
        profiles(user, workspace, input.participantPetIds());
        var settings = new Settings(input.petMode(), input.debateEnabled(), List.copyOf(input.participantPetIds()),
                current.settings().acceptedDraft(), current.settings().draftSourceRunId());
        return visible(user, workspace, persist(user, workspace, project, settings, current.version()));
    }

    @Transactional
    public View accept(UUID user, UUID workspace, UUID project, Accept input, AgentRunEntity run, AgentRunView result) {
        authorize(user, workspace, project);
        var membership = permissions.findActiveMembership(user, workspace).orElseThrow(() -> notFound());
        if (!membership.permissions().contains(PermissionCode.QUOTATION_WRITE)
                || !membership.permissions().contains(PermissionCode.QUOTATION_READ)) throw forbidden();
        if (!run.projectId().equals(project) || !run.workspaceId().equals(workspace)
                || !run.initiatedBy().equals(user) || !run.id().equals(input.runId())
                || !result.runId().equals(input.runId())) throw notFound();
        if (result.result() == null || result.result().petMessages().isEmpty()
                || result.result().quotationDraft() == null || !Set.of("COMPLETED", "PARTIAL").contains(result.status().name()))
            throw new ResponseStatusException(HttpStatus.CONFLICT, "CONVERSATION_DRAFT_UNAVAILABLE");
        lock(project, workspace);
        var current = load(user, workspace, project);
        checkVersion(current, input.expectedVersion());
        var settings = new Settings(current.settings().petMode(), current.settings().debateEnabled(),
                current.settings().participantPetIds(), result.result().quotationDraft(), input.runId());
        return persist(user, workspace, project, settings, current.version());
    }

    public Snapshot snapshot(UUID user, UUID workspace, UUID project, PetConversation.Command command) {
        var current = get(user, workspace, project);
        checkVersion(current, command.settingsVersion());
        var settings = current.settings();
        var profiles = settings.petMode() ? profiles(user, workspace, settings.participantPetIds()) : List.<PetProfile>of();
        if (settings.petMode() && profiles.isEmpty()) throw invalid();
        if (command.recipientPetId() != null && (!settings.petMode()
                || !settings.participantPetIds().contains(command.recipientPetId()))) throw invalid();
        var membership = permissions.findActiveMembership(user, workspace).orElseThrow(() -> notFound());
        boolean canReadQuotes = membership.permissions().contains(PermissionCode.QUOTATION_READ);
        var history = jdbc.query("SELECT user_text, messages_json::text FROM app.project_pet_turn"
                + " WHERE workspace_id = ? AND project_id = ? AND user_id = ? ORDER BY created_at DESC, run_id DESC LIMIT 6",
                (row, index) -> new PetConversation.Turn(row.getString(1),
                        canReadQuotes ? List.of(mapper.readValue(row.getString(2), AgentRunView.PetMessage[].class)) : List.of()),
                workspace, project, user);
        Collections.reverse(history);
        var rates = canReadQuotes
                ? jdbc.queryForList("SELECT id, name, unit, rate, currency FROM app.rate_card"
                        + " WHERE workspace_id = ? AND active = true ORDER BY name, id LIMIT 100", workspace)
                : List.<Map<String, Object>>of();
        return new Snapshot(profiles, new PetConversation(settings.petMode(), settings.debateEnabled(),
                command.recipientPetId(), history, settings.acceptedDraft(), rates));
    }

    public void recordStart(UUID user, UUID workspace, UUID project, UUID run, String text) {
        jdbc.update("INSERT INTO app.project_pet_turn(run_id, workspace_id, project_id, user_id, user_text)"
                + " VALUES (?, ?, ?, ?, ?)", run, workspace, project, user, text);
    }

    public void recordResult(AgentRunEntity run, AgentRunView view) {
        if (view.result() == null || view.result().petMessages().isEmpty()) return;
        jdbc.update("UPDATE app.project_pet_turn SET messages_json = ?::jsonb WHERE run_id = ?"
                + " AND jsonb_array_length(messages_json) <= ?",
                mapper.writeValueAsString(view.result().petMessages()), run.id(), view.result().petMessages().size());
    }

    private List<PetProfile> profiles(UUID user, UUID workspace, List<UUID> ids) {
        var owned = pets.list(user, workspace).pets();
        return ids.stream().map(id -> owned.stream().filter(p -> p.id().equals(id) && !p.archived()
                        && p.profile() != null && id.equals(p.profile().petId()))
                .findFirst().orElseThrow(() -> new ResponseStatusException(HttpStatus.CONFLICT, "CONVERSATION_PET_UNAVAILABLE"))
                .profile()).toList();
    }

    private View persist(UUID user, UUID workspace, UUID project, Settings settings, long version) {
        jdbc.update("INSERT INTO app.project_pet_conversation(workspace_id, project_id, user_id, settings_json, version)"
                + " VALUES (?, ?, ?, ?::jsonb, ?) ON CONFLICT (workspace_id, project_id, user_id)"
                + " DO UPDATE SET settings_json = EXCLUDED.settings_json, version = EXCLUDED.version",
                workspace, project, user, mapper.writeValueAsString(settings), version + 1);
        return new View(settings, version + 1);
    }

    private void authorize(UUID user, UUID workspace, UUID project) {
        var membership = permissions.findActiveMembership(user, workspace).orElseThrow(() -> notFound());
        if (!membership.permissions().contains(PermissionCode.PROJECT_READ)
                || !membership.permissions().contains(PermissionCode.AGENT_RUN)) throw forbidden();
        if (projects.findByIdAndWorkspaceId(project, workspace).isEmpty()) throw notFound();
    }
    private void lock(UUID project, UUID workspace) {
        if (projects.findByIdAndWorkspaceIdForUpdate(project, workspace).isEmpty()) throw notFound();
        if (jdbc.queryForObject("SELECT count(*) FROM app.agent_run WHERE project_id = ? AND workspace_id = ?"
                + " AND status IN ('QUEUED', 'RUNNING', 'WAITING_FOR_USER')", Integer.class, project, workspace) > 0)
            throw new ResponseStatusException(HttpStatus.CONFLICT, "CONVERSATION_RUN_ACTIVE");
    }
    private static void checkVersion(View current, long expected) {
        if (current.version() != expected) throw new ResponseStatusException(HttpStatus.CONFLICT, "CONVERSATION_SETTINGS_CHANGED");
    }
    private static ResponseStatusException notFound() { return new ResponseStatusException(HttpStatus.NOT_FOUND); }
    private static ResponseStatusException forbidden() { return new ResponseStatusException(HttpStatus.FORBIDDEN); }
    private static ResponseStatusException invalid() { return new ResponseStatusException(HttpStatus.UNPROCESSABLE_CONTENT, "CONVERSATION_INVALID_TEAM"); }
}
