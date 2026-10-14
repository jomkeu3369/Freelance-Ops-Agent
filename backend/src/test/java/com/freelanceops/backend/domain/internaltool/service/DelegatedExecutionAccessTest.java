package com.freelanceops.backend.domain.internaltool.service;

import com.freelanceops.backend.domain.agentrun.entity.AgentRunEntity;
import com.freelanceops.backend.domain.agentrun.model.AgentRunStatus;
import com.freelanceops.backend.domain.agentrun.model.Provider;
import com.freelanceops.backend.domain.agentrun.repository.AgentRunRepository;
import com.freelanceops.backend.domain.agentrun.service.AgentRunCommandQueue;
import com.freelanceops.backend.domain.agentrun.service.ByokExecutionService;
import com.freelanceops.backend.domain.internaltool.security.DelegationPrincipal;
import com.freelanceops.backend.domain.internaltool.security.DelegationTokenException;
import com.freelanceops.backend.domain.project.entity.ProjectEntity;
import com.freelanceops.backend.domain.project.repository.ProjectRepository;
import com.freelanceops.backend.domain.workspace.policy.MembershipPermissions;
import com.freelanceops.backend.domain.workspace.policy.PermissionCode;
import com.freelanceops.backend.domain.workspace.repository.WorkspacePermissionReader;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.junit.jupiter.params.provider.ValueSource;
import java.time.Instant;
import java.util.*;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

class DelegatedExecutionAccessTest {
    private final AgentRunRepository runs = mock(AgentRunRepository.class);
    private final ProjectRepository projects = mock(ProjectRepository.class);
    private final WorkspacePermissionReader permissions = mock(WorkspacePermissionReader.class);
    private final AgentRunCommandQueue commands = mock(AgentRunCommandQueue.class);
    private final ByokExecutionService byok = mock(ByokExecutionService.class);
    private final DelegatedExecutionAccess access = new DelegatedExecutionAccess(runs, projects, permissions, commands, byok);
    private final UUID id = UUID.randomUUID(), workspace = UUID.randomUUID(), project = UUID.randomUUID(), user = UUID.randomUUID();
    private final Instant created = Instant.now();
    private final Set<String> scope = Set.of("agent.run", "project.read");

    private AgentRunEntity configure() {
        var run = new AgentRunEntity(id, workspace, project, UUID.randomUUID(), user, Provider.OPENAI, "gpt-test", AgentRunStatus.RUNNING, created);
        when(runs.findByIdAndWorkspaceIdForUpdate(id, workspace)).thenReturn(Optional.of(run));
        when(projects.findByIdAndWorkspaceId(project, workspace)).thenReturn(Optional.of(new ProjectEntity(project, workspace, "Synthetic", "Input", "KRW", null, null, null)));
        when(permissions.findActiveMembership(user, workspace)).thenReturn(Optional.of(new MembershipPermissions(UUID.randomUUID(), Set.of(PermissionCode.AGENT_RUN, PermissionCode.PROJECT_READ))));
        when(commands.originalPermissions(id)).thenReturn(List.copyOf(scope));
        return run;
    }
    private DelegationPrincipal principal(UUID run, UUID tenant, UUID source, UUID actor, Set<String> claims, Instant deadline) {
        return new DelegationPrincipal(actor.toString(), UUID.randomUUID().toString(), run, tenant, source, actor, claims, deadline);
    }
    private DelegationPrincipal valid() { return principal(id, workspace, project, user, scope, created.plusSeconds(180)); }

    @Test void permitsOnlyTheOriginalBoundedActiveAuthority() { configure(); access.require(valid()); verifyNoInteractions(byok); }
    @ParameterizedTest @EnumSource(value=AgentRunStatus.class, names={"WAITING_FOR_USER", "COMPLETED", "PARTIAL", "FAILED", "CANCELLED"})
    void rejectsStoppedRuns(AgentRunStatus state) { configure().updateStatus(state, Instant.now()); assertThatThrownBy(() -> access.require(valid())).isInstanceOf(DelegationTokenException.class); }
    @ParameterizedTest @ValueSource(strings={"run", "tenant", "project", "owner"})
    void rejectsChangedBindings(String binding) {
        configure();
        var changed = principal(binding.equals("run") ? UUID.randomUUID() : id,
            binding.equals("tenant") ? UUID.randomUUID() : workspace,
            binding.equals("project") ? UUID.randomUUID() : project,
            binding.equals("owner") ? UUID.randomUUID() : user, scope, created.plusSeconds(180));
        assertThatThrownBy(() -> access.require(changed)).isInstanceOf(DelegationTokenException.class);
    }
    @ParameterizedTest @ValueSource(strings={"member", "agent.run", "project.read", "snapshot", "deletion"})
    void reflectsRevocationBeforeTheNextTool(String revoked) {
        configure();
        if (revoked.equals("member")) when(permissions.findActiveMembership(user, workspace)).thenReturn(Optional.empty());
        if (revoked.equals("agent.run") || revoked.equals("project.read")) when(permissions.findActiveMembership(user, workspace)).thenReturn(Optional.of(new MembershipPermissions(UUID.randomUUID(), Set.of(revoked.equals("agent.run") ? PermissionCode.PROJECT_READ : PermissionCode.AGENT_RUN))));
        if (revoked.equals("snapshot")) when(commands.originalPermissions(id)).thenThrow(new IllegalStateException("snapshot missing"));
        if (revoked.equals("deletion")) { var deleting = new ProjectEntity(project, workspace, "Synthetic", "Input", "KRW", null, null, null); deleting.requestDeletion(Instant.now()); when(projects.findByIdAndWorkspaceId(project, workspace)).thenReturn(Optional.of(deleting)); }
        assertThatThrownBy(() -> access.require(valid())).isInstanceOf(DelegationTokenException.class);
    }
    @Test void rejectsExtendedExpiredAndControlAuthority() {
        configure();
        for (Instant deadline : Arrays.asList(created.plusSeconds(181), created.minusSeconds(1), null)) {
            assertThatThrownBy(() -> access.require(principal(id, workspace, project, user, scope, deadline))).isInstanceOf(DelegationTokenException.class);
        }
    }
    @Test void rejectsPermissionsAddedAfterTheOriginalRequest() {
        configure();
        when(permissions.findActiveMembership(user, workspace)).thenReturn(Optional.of(new MembershipPermissions(UUID.randomUUID(), Set.of(PermissionCode.AGENT_RUN, PermissionCode.PROJECT_READ, PermissionCode.DOCUMENT_READ))));
        assertThatThrownBy(() -> access.require(principal(id, workspace, project, user, Set.of("agent.run", "project.read", "document.read"), created.plusSeconds(180)))).isInstanceOf(DelegationTokenException.class);
    }
    @Test void closedPersonalScopeCannotAuthorizeMoreWork() {
        var run = configure(); run.useCredential(UUID.randomUUID());
        when(byok.validateRun(run)).thenThrow(new com.freelanceops.backend.domain.agentrun.service.ByokExecutionException(org.springframework.http.HttpStatus.CONFLICT, "BYOK_SCOPE_CLOSED", "closed"));
        assertThatThrownBy(() -> access.require(valid())).isInstanceOf(DelegationTokenException.class);
    }
}
