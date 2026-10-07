package com.freelanceops.backend.domain.agentrun.controller;

import com.freelanceops.backend.domain.agentrun.entity.AgentRunCommandEntity;
import com.freelanceops.backend.domain.agentrun.entity.AgentRunEntity;
import com.freelanceops.backend.domain.agentrun.model.AgentRunCommandType;
import com.freelanceops.backend.domain.agentrun.model.AgentRunStatus;
import com.freelanceops.backend.domain.agentrun.repository.AgentRunCommandRepository;
import com.freelanceops.backend.domain.agentrun.repository.AgentRunRepository;
import com.freelanceops.backend.domain.agentrun.service.AgentRunHistoryService;
import com.freelanceops.backend.domain.project.entity.ProjectEntity;
import com.freelanceops.backend.domain.project.repository.ProjectRepository;
import com.freelanceops.backend.domain.workspace.policy.MembershipPermissions;
import com.freelanceops.backend.domain.workspace.policy.PermissionCode;
import com.freelanceops.backend.domain.workspace.repository.WorkspacePermissionReader;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.ObjectMapper;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.hamcrest.Matchers.nullValue;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class AgentRunHistoryControllerTest {
    @Test
    void rejectsMissingAuthenticationBeforeAccessingHistory() {
        AgentRunHistoryService history = mock(AgentRunHistoryService.class);
        AgentRunHistoryController controller = new AgentRunHistoryController(history);
        assertThatThrownBy(() -> controller.list(UUID.randomUUID(), UUID.randomUUID(), 20, null))
            .isInstanceOfSatisfying(ResponseStatusException.class,
                error -> assertThat(error.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED));
        verifyNoInteractions(history);
    }

    @Test
    void rejectsInvalidOrUnauthenticatedSubjectBeforeAccessingHistory() {
        var history = mock(AgentRunHistoryService.class);
        var controller = new AgentRunHistoryController(history);
        var unauthenticated = UsernamePasswordAuthenticationToken.unauthenticated(UUID.randomUUID().toString(), "unused");
        var invalid = UsernamePasswordAuthenticationToken.authenticated("not-a-uuid", "unused", List.of());
        for (var authentication : List.of(unauthenticated, invalid)) {
            assertThatThrownBy(() -> controller.list(UUID.randomUUID(), UUID.randomUUID(), 20, authentication))
                .isInstanceOfSatisfying(ResponseStatusException.class,
                    error -> assertThat(error.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED));
        }
        verifyNoInteractions(history);
    }

    @Test
    void doesNotMisreportServiceFailureAsAuthenticationFailure() {
        var history = mock(AgentRunHistoryService.class);
        var controller = new AgentRunHistoryController(history);
        UUID user = UUID.randomUUID(), workspace = UUID.randomUUID(), project = UUID.randomUUID();
        var failure = new IllegalArgumentException("service failure");
        when(history.list(user, workspace, project, 20)).thenThrow(failure);
        var authentication = UsernamePasswordAuthenticationToken.authenticated(user.toString(), "unused", List.of());
        assertThatThrownBy(() -> controller.list(workspace, project, 20, authentication)).isSameAs(failure);
    }

    @Test
    void returns200WithHealthyAndUnreadableTurnsThroughRealHistoryService() throws Exception {
        var permissions = mock(WorkspacePermissionReader.class);
        var projects = mock(ProjectRepository.class);
        var runs = mock(AgentRunRepository.class);
        var commands = mock(AgentRunCommandRepository.class);
        var history = new AgentRunHistoryService(permissions, projects, runs, commands, new ObjectMapper());
        var mvc = MockMvcBuilders.standaloneSetup(new AgentRunHistoryController(history)).build();
        UUID user = UUID.randomUUID(), workspace = UUID.randomUUID(), project = UUID.randomUUID();
        when(permissions.findActiveMembership(user, workspace)).thenReturn(Optional.of(new MembershipPermissions(
            UUID.randomUUID(), Set.of(PermissionCode.AGENT_RUN, PermissionCode.PROJECT_READ))));
        when(projects.findByIdAndWorkspaceId(project, workspace)).thenReturn(Optional.of(mock(ProjectEntity.class)));
        var healthy = run();
        var damaged = run();
        when(runs.findByWorkspaceIdAndProjectIdOrderByCreatedAtDesc(workspace, project, PageRequest.of(0, 20)))
            .thenReturn(List.of(healthy, damaged));
        var command = mock(AgentRunCommandEntity.class);
        when(command.payload()).thenReturn("{\"input\":{\"requirementText\":\"고객 원문 / Original text\"}}");
        when(commands.findFirstByRunIdAndCommandTypeOrderByCreatedAtAsc(healthy.id(), AgentRunCommandType.START))
            .thenReturn(Optional.of(command));
        when(commands.findFirstByRunIdAndCommandTypeOrderByCreatedAtAsc(damaged.id(), AgentRunCommandType.START))
            .thenReturn(Optional.empty());

        mvc.perform(get("/api/v2/workspaces/{workspace}/projects/{project}/agent-runs/history", workspace, project)
                .principal(UsernamePasswordAuthenticationToken.authenticated(user.toString(), "unused", List.of())))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.length()").value(2))
            .andExpect(jsonPath("$[0].runId").value(healthy.id().toString()))
            .andExpect(jsonPath("$[0].requirementText").value("고객 원문 / Original text"))
            .andExpect(jsonPath("$[0].originalInputStatus").value("AVAILABLE"))
            .andExpect(jsonPath("$[0].originalInputIssue").value(nullValue()))
            .andExpect(jsonPath("$[1].runId").value(damaged.id().toString()))
            .andExpect(jsonPath("$[1].status").value("COMPLETED"))
            .andExpect(jsonPath("$[1].createdAt").value("2026-10-01T10:00:00Z"))
            .andExpect(jsonPath("$[1].requirementText").value(nullValue()))
            .andExpect(jsonPath("$[1].attachments").isArray())
            .andExpect(jsonPath("$[1].originalInputStatus").value("UNAVAILABLE"))
            .andExpect(jsonPath("$[1].originalInputIssue").value("MISSING_START"));
        verify(runs).findByWorkspaceIdAndProjectIdOrderByCreatedAtDesc(workspace, project, PageRequest.of(0, 20));
    }

    private static AgentRunEntity run() {
        var run = mock(AgentRunEntity.class);
        when(run.id()).thenReturn(UUID.randomUUID());
        when(run.status()).thenReturn(AgentRunStatus.COMPLETED);
        when(run.createdAt()).thenReturn(Instant.parse("2026-10-01T10:00:00Z"));
        return run;
    }
}
