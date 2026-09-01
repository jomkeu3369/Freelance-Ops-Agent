package com.freelanceops.backend.domain.agenttask.service;

import com.freelanceops.backend.domain.agentrun.repository.AgentRunRepository;
import com.freelanceops.backend.domain.agenttask.dto.request.AgentTaskInstructionRequest;
import com.freelanceops.backend.domain.agenttask.dto.request.AgentTaskRedirectRequest;
import com.freelanceops.backend.domain.agenttask.entity.AgentTaskEntity;
import com.freelanceops.backend.domain.agenttask.entity.AgentTaskExecutionProfileEntity;
import com.freelanceops.backend.domain.agenttask.entity.AgentTaskExecutionProfileId;
import com.freelanceops.backend.domain.agenttask.model.AgentTaskCommandType;
import com.freelanceops.backend.domain.agenttask.model.AgentTaskStatus;
import com.freelanceops.backend.domain.agenttask.repository.AgentTaskExecutionProfileRepository;
import com.freelanceops.backend.domain.agenttask.repository.AgentTaskRepository;
import com.freelanceops.backend.domain.agentrun.model.DepartmentName;
import com.freelanceops.backend.domain.workspace.policy.MembershipPermissions;
import com.freelanceops.backend.domain.workspace.policy.PermissionCode;
import com.freelanceops.backend.domain.workspace.repository.WorkspacePermissionReader;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class AgentTaskGatewayServiceTest {

    private final WorkspacePermissionReader permissions = mock(WorkspacePermissionReader.class);
    private final AgentRunRepository runs = mock(AgentRunRepository.class);
    private final AgentTaskRepository tasks = mock(AgentTaskRepository.class);
    private final AgentTaskExecutionProfileRepository profiles = mock(AgentTaskExecutionProfileRepository.class);
    private final AgentTaskRegistry registry = mock(AgentTaskRegistry.class);
    private final AgentTaskCommandOutbox commands = mock(AgentTaskCommandOutbox.class);
    private final AgentTaskGatewayService service = new AgentTaskGatewayService(permissions, runs, tasks, profiles, registry, commands);

    @Test
    void softUpdatePersistsCommandBeforeMarkingTaskPending() {
        Fixture fixture = fixture();
        AgentTaskInstructionRequest request = new AgentTaskInstructionRequest(1, "update-1", "공식 출처를 추가해 주세요");
        UUID commandId = UUID.randomUUID();
        authorize(fixture, PermissionCode.AGENT_RESPOND);
        when(commands.enqueueWithResult(eq(fixture.workspaceId()), eq(fixture.runId()), eq(fixture.task().id()), eq(1),
            eq(AgentTaskCommandType.SOFT_UPDATE), eq("update-1"), eq(Map.of("instruction", request.instruction())),
            eq(fixture.userId()), eq(2L), eq(3L), any(Instant.class)))
            .thenReturn(new AgentTaskCommandOutbox.EnqueueResult(commandId, true));

        var response = service.softUpdate(fixture.userId(), fixture.workspaceId(), fixture.runId(), fixture.task().id(), request);

        assertThat(response.commandId()).isEqualTo(commandId);
        assertThat(response.status()).isEqualTo(AgentTaskStatus.UPDATE_PENDING);
    }

    @Test
    void repeatedHardRedirectDoesNotIncrementRevisionAgain() {
        Fixture fixture = fixture();
        AgentTaskRedirectRequest request = new AgentTaskRedirectRequest(1, "redirect-1", "objective:2");
        UUID commandId = UUID.randomUUID();
        authorize(fixture, PermissionCode.AGENT_RESPOND);
        when(commands.enqueueWithResult(eq(fixture.workspaceId()), eq(fixture.runId()), eq(fixture.task().id()), eq(1),
            eq(AgentTaskCommandType.HARD_REDIRECT), eq("redirect-1"), eq(Map.of("objective_reference", "objective:2")),
            eq(fixture.userId()), eq(2L), eq(3L), any(Instant.class)))
            .thenReturn(new AgentTaskCommandOutbox.EnqueueResult(commandId, false));

        var response = service.hardRedirect(fixture.userId(), fixture.workspaceId(), fixture.runId(), fixture.task().id(), request);

        assertThat(response.commandId()).isEqualTo(commandId);
        verify(registry, never()).hardRedirect(eq(fixture.task().id()), eq(fixture.workspaceId()), eq(1),
            eq("objective:2"), any(Instant.class));
    }

    @Test
    void staleRevisionIsReportedAsConflict() {
        Fixture fixture = fixture();
        AgentTaskInstructionRequest request = new AgentTaskInstructionRequest(1, "update-1", "새 지시");
        authorize(fixture, PermissionCode.AGENT_RESPOND);
        fixture.task().redirect(1, fixture.now());
        when(commands.enqueueWithResult(any(), any(), any(), eq(1), eq(AgentTaskCommandType.SOFT_UPDATE),
            any(), any(), any(), anyLong(), anyLong(), any(Instant.class)))
            .thenReturn(new AgentTaskCommandOutbox.EnqueueResult(UUID.randomUUID(), true));

        assertThatThrownBy(() -> service.softUpdate(fixture.userId(), fixture.workspaceId(), fixture.runId(),
            fixture.task().id(), request)).isInstanceOfSatisfying(ResponseStatusException.class,
                error -> assertThat(error.getStatusCode()).isEqualTo(HttpStatus.CONFLICT));
    }

    private void authorize(Fixture fixture, PermissionCode permission) {
        when(permissions.findActiveMembership(fixture.userId(), fixture.workspaceId()))
            .thenReturn(Optional.of(new MembershipPermissions(UUID.randomUUID(), Set.of(permission))));
        when(runs.existsByIdAndWorkspaceId(fixture.runId(), fixture.workspaceId())).thenReturn(true);
        when(tasks.findByIdAndWorkspaceId(fixture.task().id(), fixture.workspaceId())).thenReturn(Optional.of(fixture.task()));
        when(profiles.findById(new AgentTaskExecutionProfileId(fixture.task().id(), 1))).thenReturn(Optional.of(fixture.profile()));
        when(fixture.profile().workspaceId()).thenReturn(fixture.workspaceId());
        when(fixture.profile().runId()).thenReturn(fixture.runId());
        when(fixture.profile().authorizationRevision()).thenReturn(2L);
        when(fixture.profile().budgetRevision()).thenReturn(3L);
    }

    private static Fixture fixture() {
        Instant now = Instant.parse("2026-09-01T00:00:00Z");
        UUID userId = UUID.randomUUID();
        UUID workspaceId = UUID.randomUUID();
        UUID runId = UUID.randomUUID();
        AgentTaskEntity task = new AgentTaskEntity(UUID.randomUUID(), workspaceId, runId, null,
            DepartmentName.RESEARCH, "research-read-v1", "Research #1", "objective:1", 3, null, now);
        return new Fixture(now, userId, workspaceId, runId, task, mock(AgentTaskExecutionProfileEntity.class));
    }

    private record Fixture(Instant now, UUID userId, UUID workspaceId, UUID runId, AgentTaskEntity task,
                           AgentTaskExecutionProfileEntity profile) {
    }
}
