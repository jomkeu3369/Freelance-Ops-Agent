package com.freelanceops.backend.domain.agentrun.service;

import com.freelanceops.backend.domain.agentrun.client.PetGenerationClient;
import com.freelanceops.backend.domain.agentrun.client.dto.request.InternalAgentRunRequest.TrustedRunContext;
import com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest.ModelSelection;
import com.freelanceops.backend.domain.agentrun.security.DelegationTokenIssuer;
import com.freelanceops.backend.domain.project.repository.ProjectRepository;
import com.freelanceops.backend.domain.workspace.policy.PermissionCode;
import com.freelanceops.backend.domain.workspace.repository.WorkspacePermissionReader;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;
import java.util.UUID;

@Service
public class PetGenerationService {
    private final AIConnectionService connections;
    private final PetProfileService profiles;
    private final WorkspacePermissionReader permissions;
    private final ProjectRepository projects;
    private final DelegationTokenIssuer tokens;
    private final PetGenerationClient client;
    private final JdbcTemplate jdbc;
    private final TransactionTemplate transaction;

    public PetGenerationService(AIConnectionService connections, PetProfileService profiles, WorkspacePermissionReader permissions,
        ProjectRepository projects, DelegationTokenIssuer tokens, PetGenerationClient client, JdbcTemplate jdbc, PlatformTransactionManager transactions) {
        this.connections = connections; this.profiles = profiles; this.permissions = permissions; this.projects = projects;
        this.tokens = tokens; this.client = client; this.jdbc = jdbc; this.transaction = new TransactionTemplate(transactions);
    }

    public PetGenerationClient.Output generate(UUID user, UUID workspace, UUID project, ModelSelection model, String description, String slot) {
        connections.authorize(user, workspace);
        var membership = permissions.findActiveMembership(user, workspace).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        if (!membership.permissions().contains(PermissionCode.PROJECT_READ)) throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        projects.findByIdAndWorkspaceId(project, workspace).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND)).requireNotDeleting();
        connections.validate(user, workspace, model.credentialId(), model.provider(), model.model());
        UUID id = UUID.randomUUID();
        // Serialize quota reservation across instances. Failed/in-flight calls also consume a slot.
        transaction.executeWithoutResult(status -> {
            jdbc.query("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))", (row, n) -> 0, workspace + ":pet:" + user);
            Long count = jdbc.queryForObject("SELECT count(*) FROM app.pet_generation WHERE workspace_id = ? AND user_id = ? AND created_at >= (date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')", Long.class, workspace, user);
            if (count != null && count >= 20) throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "Daily pet generation limit reached");
            jdbc.update("INSERT INTO app.pet_generation(id, workspace_id, user_id, provider, model, credential_id) VALUES (?, ?, ?, ?, ?, ?)", id, workspace, user, model.provider().name(), model.model(), model.credentialId());
        });
        try {
            var codes = membership.permissions().stream().map(PermissionCode::code).sorted().toList();
            var context = new TrustedRunContext(id, UUID.randomUUID(), id.toString(), workspace, project, user, codes);
            var result = client.generate(new PetGenerationClient.Input(context, model, description, slot), tokens.issue(id, workspace, project, user, codes));
            if (result == null || !id.equals(result.runId()) || result.provider() != model.provider() || !model.model().equals(result.model()) || result.profile() == null || !slot.equals(result.profile().slot()) || result.inputTokens() < 0 || result.outputTokens() < 0) throw new IllegalStateException("Invalid pet generation response");
            profiles.validate(result.profile());
            jdbc.update("UPDATE app.pet_generation SET status = 'COMPLETED', input_tokens = ?, output_tokens = ? WHERE id = ? AND workspace_id = ? AND user_id = ?", result.inputTokens(), result.outputTokens(), id, workspace, user);
            return result;
        } catch (RuntimeException error) {
            jdbc.update("UPDATE app.pet_generation SET status = 'FAILED' WHERE id = ? AND workspace_id = ? AND user_id = ?", id, workspace, user);
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Pet generation failed; your saved profile is unchanged");
        }
    }
}
