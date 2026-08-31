package com.freelanceops.backend.domain.agenttask.service;

import com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest;
import com.freelanceops.backend.domain.agentrun.entity.AgentRunEntity;
import com.freelanceops.backend.domain.agentrun.model.AgentRunStatus;
import com.freelanceops.backend.domain.agentrun.model.DepartmentName;
import com.freelanceops.backend.domain.agentrun.model.Provider;
import com.freelanceops.backend.domain.agentrun.model.ReasoningEffort;
import com.freelanceops.backend.domain.agentrun.repository.AgentRunRepository;
import com.freelanceops.backend.domain.agentrun.service.AgentBudgetPolicy;
import com.freelanceops.backend.domain.agenttask.dto.request.AgentTaskExecutionProfileRequest;
import com.freelanceops.backend.domain.agenttask.entity.AgentTaskEntity;
import com.freelanceops.backend.domain.agenttask.model.AgentTaskRiskLevel;
import com.freelanceops.backend.domain.agenttask.model.AgentTaskRoute;
import com.freelanceops.backend.domain.agenttask.model.AgentTaskToolProfile;
import com.freelanceops.backend.domain.internaltool.security.DelegationPrincipal;
import com.freelanceops.backend.domain.workspace.policy.MembershipPermissions;
import com.freelanceops.backend.domain.workspace.policy.PermissionCode;
import com.freelanceops.backend.domain.workspace.repository.WorkspacePermissionReader;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.util.EnumSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class AgentTaskGuardTest {

    private final WorkspacePermissionReader permissions = mock(WorkspacePermissionReader.class);
    private final AgentRunRepository runs = mock(AgentRunRepository.class);
    private final AgentBudgetPolicy budgetPolicy = mock(AgentBudgetPolicy.class);
    private final AgentTaskGuard guard = new AgentTaskGuard(
        permissions, runs, budgetPolicy, "route-profile-v1", "task-guard-v1");

    @Test
    void acceptsCurrentLeastPrivilegeReadOnlyProfileAndAssignsServerRevisions() {
        Fixture fixture = fixture();

        var entity = guard.validate(fixture.task, fixture.profile, fixture.principal, fixture.now);

        assertThat(entity.authorizationRevision()).isPositive();
        assertThat(entity.budgetRevision()).isEqualTo(1);
        assertThat(entity.permissions()).containsExactly("agent.run", "project.read");
        verify(budgetPolicy).enforce(fixture.profile.budget());
    }

    @Test
    void rejectsPermissionThatWasRevokedAfterDelegationTokenIssuance() {
        Fixture fixture = fixture();
        when(permissions.findActiveMembership(fixture.run.initiatedBy(), fixture.task.workspaceId()))
            .thenReturn(Optional.of(new MembershipPermissions(UUID.randomUUID(), EnumSet.of(PermissionCode.AGENT_RUN))));

        assertThatThrownBy(() -> guard.validate(fixture.task, fixture.profile, fixture.principal, fixture.now))
            .isInstanceOf(ResponseStatusException.class).hasMessageContaining("TASK_PERMISSION_DENIED");
    }

    @Test
    void rejectsWriteProfileUntilActionGatewayIsEnabled() {
        Fixture fixture = fixture();
        AgentTaskExecutionProfileRequest write = new AgentTaskExecutionProfileRequest(
            fixture.profile.route(), AgentTaskRiskLevel.HIGH, fixture.profile.modelProfile(),
            AgentTaskToolProfile.BOUNDED_WRITE, fixture.profile.provider(), fixture.profile.model(),
            fixture.profile.reasoningEffort(), fixture.profile.permissions(), fixture.profile.budget(),
            fixture.profile.routeProfileVersion(), fixture.profile.guardPolicyVersion());

        assertThatThrownBy(() -> guard.validate(fixture.task, write, fixture.principal, fixture.now))
            .isInstanceOf(ResponseStatusException.class).hasMessageContaining("TASK_WRITE_PROFILE_NOT_ENABLED");
    }

    @Test
    void rejectsSnapshotWithoutRequiredReadPermission() {
        Fixture fixture = fixture();
        AgentTaskExecutionProfileRequest incomplete = copy(fixture.profile,
            fixture.profile.modelProfile(), List.of("agent.run"), fixture.profile.routeProfileVersion(),
            fixture.profile.guardPolicyVersion());

        assertThatThrownBy(() -> guard.validate(fixture.task, incomplete, fixture.principal, fixture.now))
            .isInstanceOf(ResponseStatusException.class).hasMessageContaining("TASK_PERMISSION_DENIED");
    }

    @Test
    void rejectsUnapprovedModelProfile() {
        Fixture fixture = fixture();
        AgentTaskExecutionProfileRequest unapproved = copy(fixture.profile,
            "unapproved-v1", fixture.profile.permissions(), fixture.profile.routeProfileVersion(),
            fixture.profile.guardPolicyVersion());

        assertThatThrownBy(() -> guard.validate(fixture.task, unapproved, fixture.principal, fixture.now))
            .isInstanceOf(ResponseStatusException.class).hasMessageContaining("TASK_MODEL_PROFILE_UNAPPROVED");
    }

    @Test
    void rejectsStalePolicyVersion() {
        Fixture fixture = fixture();
        AgentTaskExecutionProfileRequest stale = copy(fixture.profile,
            fixture.profile.modelProfile(), fixture.profile.permissions(), fixture.profile.routeProfileVersion(),
            "task-guard-v0");

        assertThatThrownBy(() -> guard.validate(fixture.task, stale, fixture.principal, fixture.now))
            .isInstanceOf(ResponseStatusException.class).hasMessageContaining("TASK_POLICY_VERSION_STALE");
    }

    @Test
    void rejectsTaskBudgetAboveParentRunBudget() {
        Fixture fixture = fixture();
        StartAgentRunRequest.RunBudget smallerRunBudget = new StartAgentRunRequest.RunBudget(
            60, 1, 2, 1000, 1000, 1, 1, 1, 1, 1);
        AgentRunEntity limitedRun = new AgentRunEntity(fixture.run.id(), fixture.run.workspaceId(),
            fixture.run.projectId(), UUID.randomUUID(), fixture.run.initiatedBy(), Provider.OPENAI, "gpt-test",
            ReasoningEffort.LOW, smallerRunBudget, AgentRunStatus.RUNNING, fixture.now);
        when(runs.findByIdAndWorkspaceId(fixture.run.id(), fixture.run.workspaceId()))
            .thenReturn(Optional.of(limitedRun));

        assertThatThrownBy(() -> guard.validate(fixture.task, fixture.profile, fixture.principal, fixture.now))
            .isInstanceOf(ResponseStatusException.class).hasMessageContaining("TASK_BUDGET_EXCEEDED");
    }

    private static AgentTaskExecutionProfileRequest copy(AgentTaskExecutionProfileRequest source,
                                                           String modelProfile, List<String> permissions,
                                                           String routeProfileVersion, String guardPolicyVersion) {
        return new AgentTaskExecutionProfileRequest(source.route(), source.riskLevel(), modelProfile,
            source.toolProfile(), source.provider(), source.model(), source.reasoningEffort(), permissions,
            source.budget(), routeProfileVersion, guardPolicyVersion);
    }

    private Fixture fixture() {
        Instant now = Instant.parse("2026-08-31T00:00:00Z");
        UUID workspaceId = UUID.randomUUID();
        UUID runId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        AgentRunEntity run = new AgentRunEntity(runId, workspaceId, UUID.randomUUID(), UUID.randomUUID(), userId,
            Provider.OPENAI, "gpt-test", AgentRunStatus.RUNNING, now);
        AgentTaskEntity task = new AgentTaskEntity(UUID.randomUUID(), workspaceId, runId, null,
            DepartmentName.RESEARCH, "research-v1", "Research #1", "objective:1", 3, null, now);
        Set<String> delegated = Set.of("agent.run", "project.read");
        DelegationPrincipal principal = new DelegationPrincipal(userId.toString(), "token-1", runId, workspaceId,
            run.projectId(), userId, delegated);
        StartAgentRunRequest.RunBudget budget = new StartAgentRunRequest.RunBudget(
            60, 2, 2, 1000, 1000, 1, 1, 1, 1, 1);
        AgentTaskExecutionProfileRequest profile = new AgentTaskExecutionProfileRequest(
            AgentTaskRoute.REACT_AGENT, AgentTaskRiskLevel.MEDIUM, "react-read-v1",
            AgentTaskToolProfile.READ_ONLY, Provider.OPENAI, "gpt-test", ReasoningEffort.LOW,
            List.of("agent.run", "project.read"), budget, "route-profile-v1", "task-guard-v1");
        when(runs.findByIdAndWorkspaceId(runId, workspaceId)).thenReturn(Optional.of(run));
        when(permissions.findActiveMembership(userId, workspaceId)).thenReturn(Optional.of(
            new MembershipPermissions(UUID.randomUUID(), EnumSet.of(PermissionCode.AGENT_RUN, PermissionCode.PROJECT_READ))));
        return new Fixture(now, task, run, principal, profile);
    }

    private record Fixture(Instant now, AgentTaskEntity task, AgentRunEntity run,
                           DelegationPrincipal principal, AgentTaskExecutionProfileRequest profile) {
    }
}
