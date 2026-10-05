package com.freelanceops.backend.domain.agentrun.service;

import com.freelanceops.backend.domain.agentrun.entity.AgentRunCommandEntity;
import com.freelanceops.backend.domain.agentrun.entity.AgentRunEntity;
import com.freelanceops.backend.domain.agentrun.model.AgentRunCommandType;
import com.freelanceops.backend.domain.agentrun.model.AgentRunStatus;
import com.freelanceops.backend.domain.agentrun.repository.AgentRunCommandRepository;
import com.freelanceops.backend.domain.agentrun.repository.AgentRunRepository;
import com.freelanceops.backend.domain.project.entity.ProjectEntity;
import com.freelanceops.backend.domain.project.repository.ProjectRepository;
import com.freelanceops.backend.domain.workspace.policy.MembershipPermissions;
import com.freelanceops.backend.domain.workspace.policy.PermissionCode;
import com.freelanceops.backend.domain.workspace.repository.WorkspacePermissionReader;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.ObjectMapper;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class AgentRunHistoryServiceTest {
    @Mock WorkspacePermissionReader permissions;
    @Mock ProjectRepository projects;
    @Mock AgentRunRepository runs;
    @Mock AgentRunCommandRepository commands;
    AgentRunHistoryService history;

    @BeforeEach
    void setUp() {
        history = new AgentRunHistoryService(permissions, projects, runs, commands, new ObjectMapper());
    }

    @Test
    void listsOriginalUserTextFromDurableStartCommandInRequestedProject() {
        UUID user = UUID.randomUUID(), workspace = UUID.randomUUID(), project = UUID.randomUUID(), runId = UUID.randomUUID();
        when(permissions.findActiveMembership(user, workspace)).thenReturn(Optional.of(member(
            PermissionCode.AGENT_RUN, PermissionCode.PROJECT_READ)));
        when(projects.findByIdAndWorkspaceId(project, workspace)).thenReturn(Optional.of(mock(ProjectEntity.class)));
        AgentRunEntity run = mock(AgentRunEntity.class);
        Instant createdAt = Instant.parse("2026-10-01T10:00:00Z");
        when(run.id()).thenReturn(runId);
        when(run.status()).thenReturn(AgentRunStatus.RUNNING);
        when(run.createdAt()).thenReturn(createdAt);
        when(runs.findByWorkspaceIdAndProjectIdOrderByCreatedAtDesc(workspace, project, PageRequest.of(0, 20)))
            .thenReturn(List.of(run));
        AgentRunCommandEntity command = mock(AgentRunCommandEntity.class);
        when(command.payload()).thenReturn("{\"input\":{\"requirementText\":\"고객 원문 그대로 / English\"}}");
        when(commands.findFirstByRunIdAndCommandTypeOrderByCreatedAtAsc(runId, AgentRunCommandType.START))
            .thenReturn(Optional.of(command));

        var turns = history.list(user, workspace, project, 20);

        assertThat(turns).hasSize(1);
        assertThat(turns.getFirst().requirementText()).isEqualTo("고객 원문 그대로 / English");
        assertThat(turns.getFirst().runId()).isEqualTo(runId);
        assertThat(turns.getFirst().status()).isEqualTo(AgentRunStatus.RUNNING);
        assertThat(turns.getFirst().createdAt()).isEqualTo(createdAt);
    }

    @Test
    void deniesCrossWorkspaceOrProjectHistoryBeforeReadingCommands() {
        UUID user = UUID.randomUUID(), workspace = UUID.randomUUID(), project = UUID.randomUUID();
        when(permissions.findActiveMembership(user, workspace)).thenReturn(Optional.empty());
        assertThatThrownBy(() -> history.list(user, workspace, project, 20))
            .isInstanceOfSatisfying(ResponseStatusException.class,
                error -> assertThat(error.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND));
        verify(projects, never()).findByIdAndWorkspaceId(any(), any());
        verify(commands, never()).findFirstByRunIdAndCommandTypeOrderByCreatedAtAsc(any(), any());
    }

    @Test
    void deniesMemberWithoutBothRunAndProjectReadPermission() {
        UUID user = UUID.randomUUID(), workspace = UUID.randomUUID(), project = UUID.randomUUID();
        when(permissions.findActiveMembership(user, workspace)).thenReturn(Optional.of(member(PermissionCode.AGENT_RUN)));
        assertThatThrownBy(() -> history.list(user, workspace, project, 20))
            .isInstanceOfSatisfying(ResponseStatusException.class,
                error -> assertThat(error.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN));
        verify(runs, never()).findByWorkspaceIdAndProjectIdOrderByCreatedAtDesc(any(), any(), any());
    }

    @Test
    void doesNotReturnHistoryForProjectOutsideAuthorizedWorkspace() {
        UUID user = UUID.randomUUID(), workspace = UUID.randomUUID(), foreignProject = UUID.randomUUID();
        when(permissions.findActiveMembership(user, workspace)).thenReturn(Optional.of(member(
            PermissionCode.AGENT_RUN, PermissionCode.PROJECT_READ)));
        when(projects.findByIdAndWorkspaceId(foreignProject, workspace)).thenReturn(Optional.empty());
        assertThatThrownBy(() -> history.list(user, workspace, foreignProject, 20))
            .isInstanceOfSatisfying(ResponseStatusException.class,
                error -> assertThat(error.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND));
        verify(runs, never()).findByWorkspaceIdAndProjectIdOrderByCreatedAtDesc(any(), any(), any());
    }

    @Test
    void rejectsUnboundedHistoryReads() {
        assertThatThrownBy(() -> history.list(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), 51))
            .isInstanceOfSatisfying(ResponseStatusException.class,
                error -> assertThat(error.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST));
        verify(permissions, never()).findActiveMembership(any(), any());
    }

    private static MembershipPermissions member(PermissionCode... codes) {
        return new MembershipPermissions(UUID.randomUUID(), Set.of(codes));
    }
}
