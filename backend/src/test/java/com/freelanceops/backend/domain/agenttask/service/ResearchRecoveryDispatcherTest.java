package com.freelanceops.backend.domain.agenttask.service;

import com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest.RunBudget;
import com.freelanceops.backend.domain.agentrun.entity.AgentRunEntity;
import com.freelanceops.backend.domain.agentrun.model.AgentRunStatus;
import com.freelanceops.backend.domain.agentrun.model.DepartmentName;
import com.freelanceops.backend.domain.agentrun.model.Provider;
import com.freelanceops.backend.domain.agentrun.model.ReasoningEffort;
import com.freelanceops.backend.domain.agentrun.repository.AgentRunRepository;
import com.freelanceops.backend.domain.agentrun.security.DelegationTokenIssuer;
import com.freelanceops.backend.domain.agentrun.service.AgentBudgetPolicy;
import com.freelanceops.backend.domain.agenttask.dto.request.AgentTaskExecutionProfileRequest;
import com.freelanceops.backend.domain.agenttask.entity.AgentTaskAttemptEntity;
import com.freelanceops.backend.domain.agenttask.entity.AgentTaskEntity;
import com.freelanceops.backend.domain.agenttask.model.AgentTaskRiskLevel;
import com.freelanceops.backend.domain.agenttask.model.AgentTaskRoute;
import com.freelanceops.backend.domain.agenttask.model.AgentTaskToolProfile;
import com.freelanceops.backend.domain.agenttask.repository.AgentTaskAttemptRepository;
import com.freelanceops.backend.domain.agenttask.repository.AgentTaskExecutionProfileRepository;
import com.freelanceops.backend.domain.agenttask.repository.AgentTaskRepository;
import com.freelanceops.backend.domain.internaltool.security.DelegationPrincipal;
import com.freelanceops.backend.domain.workspace.policy.MembershipPermissions;
import com.freelanceops.backend.domain.workspace.policy.PermissionCode;
import com.freelanceops.backend.domain.workspace.repository.WorkspacePermissionReader;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.util.EnumSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class ResearchRecoveryDispatcherTest {

    private final AgentTaskRepository tasks = mock(AgentTaskRepository.class);
    private final AgentTaskAttemptRepository attempts = mock(AgentTaskAttemptRepository.class);
    private final AgentTaskExecutionProfileRepository profiles = mock(AgentTaskExecutionProfileRepository.class);
    private final AgentRunRepository runs = mock(AgentRunRepository.class);
    private final WorkspacePermissionReader permissions = mock(WorkspacePermissionReader.class);
    private final AgentBudgetPolicy budgets = mock(AgentBudgetPolicy.class);
    private final AgentTaskGuard guard = new AgentTaskGuard(permissions, runs, budgets, "route-profile-v1", "task-guard-v1");
    private final DelegationTokenIssuer issuer = mock(DelegationTokenIssuer.class);
    private final ResearchRecoveryClient client = mock(ResearchRecoveryClient.class);

    @Test
    void revalidatesCurrentAuthorityAndIssuesFreshReferenceOnlyRequest() {
        Fixture f = fixture();
        f.dispatcher.restore(f.task);
        f.dispatcher.restore(f.task);
        verify(issuer, times(2)).issue(f.run.id(), f.run.workspaceId(), f.run.projectId(), f.run.initiatedBy(),
            List.of("agent.run", "project.read", "agent.task.recover"));
        verify(client, times(2)).restore(eq(f.run.id()), eq(f.request), eq("fresh-token"));
        verify(permissions, times(3)).findActiveMembership(f.run.initiatedBy(), f.run.workspaceId());
    }

    @Test
    void revokedMembershipNeverIssuesOrDeliversToken() {
        Fixture f = fixture();
        when(permissions.findActiveMembership(f.run.initiatedBy(), f.run.workspaceId())).thenReturn(Optional.empty());
        assertThatThrownBy(() -> f.dispatcher.restore(f.task)).isInstanceOf(ResponseStatusException.class);
        verifyNoInteractions(issuer, client);
    }

    @Test
    void changedPermissionsRequireReadmissionEvenIfStillReadOnly() {
        Fixture f = fixture();
        when(permissions.findActiveMembership(f.run.initiatedBy(), f.run.workspaceId())).thenReturn(Optional.of(
            new MembershipPermissions(UUID.randomUUID(), EnumSet.of(PermissionCode.AGENT_RUN, PermissionCode.PROJECT_READ, PermissionCode.AGENT_CANCEL))));
        assertThatThrownBy(() -> f.dispatcher.restore(f.task)).isInstanceOf(IllegalStateException.class).hasMessageContaining("stale");
        verifyNoInteractions(issuer, client);
    }

    @Test
    void changedBudgetPolicyStopsRecoveryBeforeIssuingToken() {
        Fixture f = fixture();
        doThrow(new IllegalStateException("budget denied")).when(budgets).enforce(any());
        assertThatThrownBy(() -> f.dispatcher.restore(f.task)).isInstanceOf(IllegalStateException.class);
        verifyNoInteractions(issuer, client);
    }

    @Test
    void emptyAllowlistFailsClosed() {
        assertThatThrownBy(() -> new ResearchRecoveryDispatcher(tasks, attempts, profiles, runs, guard, issuer, client, ""))
            .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void aFailedCandidateDoesNotStopTheRestOfTheBatch() {
        Fixture f = fixture();
        when(tasks.findRecoveryCandidates(any(), any(), any(), any())).thenReturn(List.of(f.task, f.task));
        doThrow(new IllegalStateException("temporary")).doNothing().when(client).restore(any(), any(), any());
        f.dispatcher.refresh();
        verify(client, times(2)).restore(any(), any(), any());
    }

    private Fixture fixture() {
        Instant now = Instant.now();
        UUID workspaceId = UUID.randomUUID();
        var run = new AgentRunEntity(UUID.randomUUID(), workspaceId, UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), Provider.OPENAI, "gpt-test", AgentRunStatus.RUNNING, now);
        var task = new AgentTaskEntity(UUID.randomUUID(), workspaceId, run.id(), null, DepartmentName.RESEARCH, "research-read-v1", "Research #1", "run:reference", 3, null, now);
        task.dispatch(1, now);
        var attempt = new AgentTaskAttemptEntity(UUID.randomUUID(), workspaceId, task.id(), 1, 1, 30.0, "pilot-static-v1", Map.of(), now);
        var budget = new RunBudget(60, 2, 2, 1000, 1000, 1, 1, 1, 0, 0);
        var profileRequest = new AgentTaskExecutionProfileRequest(AgentTaskRoute.REACT_AGENT, AgentTaskRiskLevel.LOW,
            "react-read-v1", AgentTaskToolProfile.READ_ONLY, Provider.OPENAI, "gpt-test", ReasoningEffort.LOW,
            List.of("agent.run", "project.read"), budget, "route-profile-v1", "task-guard-v1");
        when(runs.findByIdAndWorkspaceId(run.id(), workspaceId)).thenReturn(Optional.of(run));
        when(permissions.findActiveMembership(run.initiatedBy(), workspaceId)).thenReturn(Optional.of(
            new MembershipPermissions(UUID.randomUUID(), EnumSet.of(PermissionCode.AGENT_RUN, PermissionCode.PROJECT_READ))));
        var principal = new DelegationPrincipal(run.initiatedBy().toString(), "test", run.id(), workspaceId, run.projectId(), run.initiatedBy(), Set.of("agent.run", "project.read"));
        var profile = guard.validate(task, profileRequest, principal, now);
        when(tasks.findByIdAndWorkspaceId(task.id(), workspaceId)).thenReturn(Optional.of(task));
        when(profiles.findById(profile.id())).thenReturn(Optional.of(profile));
        when(attempts.findByTaskIdAndTaskRevisionAndAttemptNumber(task.id(), 1, 1)).thenReturn(Optional.of(attempt));
        when(issuer.issue(any(), any(), any(), any(), any())).thenReturn("fresh-token");
        var request = new ResearchRecoveryClient.RecoveryRequest(task.id(), 1, attempt.id(), profile.authorizationRevision(), profile.budgetRevision());
        return new Fixture(task, run, request, new ResearchRecoveryDispatcher(tasks, attempts, profiles, runs, guard, issuer, client, workspaceId.toString()));
    }

    private record Fixture(AgentTaskEntity task, AgentRunEntity run, ResearchRecoveryClient.RecoveryRequest request, ResearchRecoveryDispatcher dispatcher) {
    }
}
