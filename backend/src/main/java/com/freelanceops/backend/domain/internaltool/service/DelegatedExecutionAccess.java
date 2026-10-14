package com.freelanceops.backend.domain.internaltool.service;

import com.freelanceops.backend.domain.agentrun.model.AgentRunStatus;
import com.freelanceops.backend.domain.agentrun.repository.AgentRunRepository;
import com.freelanceops.backend.domain.agentrun.service.AgentRunCommandQueue;
import com.freelanceops.backend.domain.agentrun.service.ByokExecutionService;
import com.freelanceops.backend.domain.internaltool.security.DelegationPrincipal;
import com.freelanceops.backend.domain.internaltool.security.DelegationTokenException;
import com.freelanceops.backend.domain.project.repository.ProjectRepository;
import com.freelanceops.backend.domain.workspace.repository.WorkspacePermissionReader;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.Set;
import java.util.stream.Collectors;

/** Revalidate bounded execution authority before each internal HTTP request. */
@Service
public class DelegatedExecutionAccess {
    private static final Set<AgentRunStatus> ACTIVE = Set.of(AgentRunStatus.QUEUED, AgentRunStatus.RUNNING);
    private final AgentRunRepository runs;
    private final ProjectRepository projects;
    private final WorkspacePermissionReader permissions;
    private final AgentRunCommandQueue commands;
    private final ByokExecutionService byok;

    public DelegatedExecutionAccess(AgentRunRepository runs, ProjectRepository projects,
                                   WorkspacePermissionReader permissions, AgentRunCommandQueue commands,
                                   ByokExecutionService byok) {
        this.runs = runs;
        this.projects = projects;
        this.permissions = permissions;
        this.commands = commands;
        this.byok = byok;
    }

    // This transaction ends before the filter dispatches controller or provider work.
    @Transactional
    public void require(DelegationPrincipal principal) {
        Instant deadline = principal.executionDeadline();
        if (deadline == null || !Instant.now().isBefore(deadline)) throw denied();
        // Acquire the run lock before loading its version into this persistence context.
        // BYOK validation uses the same run -> scope order in this transaction.
        var run = runs.findByIdAndWorkspaceIdForUpdate(principal.runId(), principal.workspaceId()).orElseThrow(this::denied);
        if (!run.id().equals(principal.runId()) || !run.workspaceId().equals(principal.workspaceId())
            || !run.projectId().equals(principal.projectId()) || !run.initiatedBy().equals(principal.initiatedBy())
            || !ACTIVE.contains(run.status()) || deadline.isAfter(run.createdAt().plusSeconds(run.budget().maxDurationSeconds())))
            throw denied();
        var project = projects.findByIdAndWorkspaceId(run.projectId(), run.workspaceId()).orElseThrow(this::denied);
        if (project.deletionRequested()) throw denied();
        var current = permissions.findActiveMembership(run.initiatedBy(), run.workspaceId()).orElseThrow(this::denied)
            .permissions().stream().map(permission -> permission.code()).collect(Collectors.toSet());
        java.util.List<String> original;
        try { original = commands.originalPermissions(run.id()); }
        catch (IllegalStateException error) { throw new DelegationTokenException("original execution authority is unavailable", error); }
        if (!principal.permissions().contains("agent.run") || !principal.permissions().contains("project.read")
            || !current.containsAll(principal.permissions()) || !original.containsAll(principal.permissions())) throw denied();
        if (run.credentialId() != null) {
            try {
                var scope = byok.validateRun(run);
                if (deadline.isAfter(scope.validUntil())) throw denied();
            } catch (org.springframework.web.server.ResponseStatusException error) {
                throw new DelegationTokenException("bounded execution authority is unavailable", error);
            }
        }
        // A slow database lookup or scope lock must not admit work after the cutoff.
        if (!Instant.now().isBefore(deadline)) throw denied();
    }

    private DelegationTokenException denied() {
        return new DelegationTokenException("bounded execution authority is unavailable");
    }
}
