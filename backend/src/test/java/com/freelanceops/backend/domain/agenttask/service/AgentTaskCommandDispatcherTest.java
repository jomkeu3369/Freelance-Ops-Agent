package com.freelanceops.backend.domain.agenttask.service;

import com.freelanceops.backend.domain.agentrun.client.AgentRunClient;
import com.freelanceops.backend.domain.agentrun.client.dto.request.InternalAgentTaskCommandRequest;
import com.freelanceops.backend.domain.agentrun.client.dto.response.InternalAgentTaskCommandResponse;
import com.freelanceops.backend.domain.agentrun.entity.AgentRunEntity;
import com.freelanceops.backend.domain.agentrun.model.AgentRunStatus;
import com.freelanceops.backend.domain.agentrun.model.Provider;
import com.freelanceops.backend.domain.agentrun.repository.AgentRunRepository;
import com.freelanceops.backend.domain.agentrun.security.DelegationTokenIssuer;
import com.freelanceops.backend.domain.agenttask.model.AgentTaskCommandType;
import com.freelanceops.backend.domain.workspace.policy.MembershipPermissions;
import com.freelanceops.backend.domain.workspace.policy.PermissionCode;
import com.freelanceops.backend.domain.workspace.repository.WorkspacePermissionReader;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class AgentTaskCommandDispatcherTest {

    private final AgentTaskCommandOutbox outbox = mock(AgentTaskCommandOutbox.class);
    private final AgentRunRepository runs = mock(AgentRunRepository.class);
    private final WorkspacePermissionReader permissions = mock(WorkspacePermissionReader.class);
    private final DelegationTokenIssuer tokens = mock(DelegationTokenIssuer.class);
    private final AgentRunClient client = mock(AgentRunClient.class);
    private final AgentTaskRegistry registry = mock(AgentTaskRegistry.class);
    private final AgentTaskCommandDispatcher dispatcher = new AgentTaskCommandDispatcher(outbox, runs, permissions, tokens, client, registry);

    @Test
    void deliversRunScopedCommandAndAcknowledgesExactIdentity() {
        Fixture fixture = fixture();
        when(runs.findByIdAndWorkspaceId(fixture.run().id(), fixture.run().workspaceId())).thenReturn(Optional.of(fixture.run()));
        when(permissions.findActiveMembership(fixture.command().requestedBy(), fixture.command().workspaceId()))
            .thenReturn(Optional.of(new MembershipPermissions(UUID.randomUUID(), Set.of(PermissionCode.AGENT_CANCEL))));
        when(tokens.issue(eq(fixture.run().id()), eq(fixture.run().workspaceId()), eq(fixture.run().projectId()),
            eq(fixture.command().requestedBy()), any())).thenReturn("signed-token");
        when(client.taskCommand(eq(fixture.run().id()), any(InternalAgentTaskCommandRequest.class),
            eq("signed-token"), any())).thenReturn(new InternalAgentTaskCommandResponse(fixture.command().id(),
            fixture.command().taskId(), fixture.command().expectedTaskRevision(), "APPLIED", 1));

        assertThat(dispatcher.dispatch(fixture.command())).isTrue();

        verify(outbox).delivered(fixture.command().id(), fixture.command().deliveryAttempt());
        verify(registry).acknowledgeCancellation(eq(fixture.command().taskId()), eq(fixture.command().workspaceId()),
            eq(fixture.command().expectedTaskRevision()), any(Instant.class));
    }

    @Test
    void revokedPermissionFailsWithoutCallingAgent() {
        Fixture fixture = fixture();
        when(runs.findByIdAndWorkspaceId(fixture.run().id(), fixture.run().workspaceId())).thenReturn(Optional.of(fixture.run()));
        when(permissions.findActiveMembership(fixture.command().requestedBy(), fixture.command().workspaceId()))
            .thenReturn(Optional.of(new MembershipPermissions(UUID.randomUUID(), Set.of(PermissionCode.AGENT_RUN))));

        assertThat(dispatcher.dispatch(fixture.command())).isTrue();

        verify(outbox).fail(fixture.command().id(), fixture.command().deliveryAttempt(),
            "task command authority is no longer valid");
        verify(client, org.mockito.Mockito.never()).taskCommand(any(), any(), any(), any());
    }

    private static Fixture fixture() {
        Instant now = Instant.parse("2026-09-01T00:00:00Z");
        UUID workspaceId = UUID.randomUUID();
        UUID runId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        AgentRunEntity run = new AgentRunEntity(runId, workspaceId, UUID.randomUUID(), UUID.randomUUID(), userId,
            Provider.OPENAI, "gpt-test", AgentRunStatus.RUNNING, now);
        AgentTaskCommandOutbox.ClaimedCommand command = new AgentTaskCommandOutbox.ClaimedCommand(UUID.randomUUID(),
            workspaceId, runId, UUID.randomUUID(), 1, AgentTaskCommandType.CANCEL, "cancel-1", Map.of(), userId,
            now, 2, 3, 1);
        return new Fixture(run, command);
    }

    private record Fixture(AgentRunEntity run, AgentTaskCommandOutbox.ClaimedCommand command) {
    }
}
