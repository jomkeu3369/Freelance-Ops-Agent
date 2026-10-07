package com.freelanceops.backend.domain.agentrun.service;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.freelanceops.backend.domain.agentrun.client.dto.request.InternalAgentRunRequest;
import com.freelanceops.backend.domain.agentrun.dto.response.AgentChatTurn;
import com.freelanceops.backend.domain.agentrun.dto.response.AgentChatTurn.OriginalInputIssue;
import com.freelanceops.backend.domain.agentrun.dto.response.AgentChatTurn.OriginalInputStatus;
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
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.ObjectMapper;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class AgentRunHistoryServiceTest {
    @Mock WorkspacePermissionReader permissions;
    @Mock ProjectRepository projects;
    @Mock AgentRunRepository runs;
    @Mock AgentRunCommandRepository commands;
    final UUID user = UUID.randomUUID(), workspace = UUID.randomUUID(), project = UUID.randomUUID();
    final Instant createdAt = Instant.parse("2026-10-01T10:00:00Z");
    AgentRunHistoryService history;

    @BeforeEach
    void setUp() {
        history = new AgentRunHistoryService(permissions, projects, runs, commands, new ObjectMapper());
    }

    @Test
    void isolatesDamagedRowsWithoutLosingOrderIdentityStatusOrHealthyOriginalText() {
        authorize();
        var newest = run(AgentRunStatus.COMPLETED);
        var missing = run(AgentRunStatus.FAILED);
        var malformed = run(AgentRunStatus.CANCELLED);
        var oldest = run(AgentRunStatus.RUNNING);
        page(20, newest, missing, malformed, oldest);
        payload(newest, "{\"input\":{\"requirementText\":\"고객 원문 그대로 / English\"}}");
        when(commands.findFirstByRunIdAndCommandTypeOrderByCreatedAtAsc(missing.id(), AgentRunCommandType.START))
            .thenReturn(Optional.empty());
        payload(malformed, "{broken");
        payload(oldest, "{\"input\":{\"requirementText\":\"  older\\noriginal  \",\"attachments\":null}}");

        var turns = history.list(user, workspace, project, 20);

        assertThat(turns).extracting(AgentChatTurn::runId).containsExactly(newest.id(), missing.id(), malformed.id(), oldest.id());
        assertThat(turns).extracting(AgentChatTurn::status).containsExactly(AgentRunStatus.COMPLETED, AgentRunStatus.FAILED,
            AgentRunStatus.CANCELLED, AgentRunStatus.RUNNING);
        assertThat(turns).extracting(AgentChatTurn::createdAt).containsOnly(createdAt);
        assertThat(turns.getFirst().requirementText()).isEqualTo("고객 원문 그대로 / English");
        assertThat(turns.getLast().requirementText()).isEqualTo("  older\noriginal  ");
        assertThat(turns.getFirst().originalInputStatus()).isEqualTo(OriginalInputStatus.AVAILABLE);
        assertThat(turns.getFirst().originalInputIssue()).isNull();
        assertThat(turns.getFirst().attachments()).isEmpty();
        assertUnavailable(turns.get(1), OriginalInputIssue.MISSING_START);
        assertUnavailable(turns.get(2), OriginalInputIssue.MALFORMED_PAYLOAD);
    }

    @ParameterizedTest
    @MethodSource("unreadablePayloads")
    void reportsUnavailableInputWithoutInventingText(String payload, OriginalInputIssue issue) {
        var turn = readPayload(payload);
        assertUnavailable(turn, issue);
    }

    static Stream<Arguments> unreadablePayloads() {
        return Stream.of(
            Arguments.of(null, OriginalInputIssue.MALFORMED_PAYLOAD),
            Arguments.of(" ", OriginalInputIssue.MALFORMED_PAYLOAD),
            Arguments.of("{broken", OriginalInputIssue.MALFORMED_PAYLOAD),
            Arguments.of("null", OriginalInputIssue.MALFORMED_PAYLOAD),
            Arguments.of("[]", OriginalInputIssue.MALFORMED_PAYLOAD),
            Arguments.of("42", OriginalInputIssue.MALFORMED_PAYLOAD),
            Arguments.of("{\"input\":{\"requirementText\":\"valid\"}} {}", OriginalInputIssue.MALFORMED_PAYLOAD),
            Arguments.of("{}", OriginalInputIssue.MISSING_INPUT),
            Arguments.of("{\"input\":null}", OriginalInputIssue.MISSING_INPUT),
            Arguments.of("{\"input\":[]}", OriginalInputIssue.MISSING_INPUT),
            Arguments.of("{\"input\":{}}", OriginalInputIssue.INVALID_REQUIREMENT_TEXT),
            Arguments.of("{\"input\":{\"requirementText\":null}}", OriginalInputIssue.INVALID_REQUIREMENT_TEXT),
            Arguments.of("{\"input\":{\"requirementText\":17}}", OriginalInputIssue.INVALID_REQUIREMENT_TEXT),
            Arguments.of("{\"input\":{\"requirementText\":true}}", OriginalInputIssue.INVALID_REQUIREMENT_TEXT),
            Arguments.of("{\"input\":{\"requirementText\":{}}}", OriginalInputIssue.INVALID_REQUIREMENT_TEXT));
    }

    @Test
    void preservesEmptyTextAsOriginalRatherThanCallingItUnreadable() {
        var turn = readPayload("{\"input\":{\"requirementText\":\"\"}}");
        assertThat(turn.requirementText()).isEmpty();
        assertThat(turn.originalInputStatus()).isEqualTo(OriginalInputStatus.AVAILABLE);
    }

    @Test
    void projectsHistoryWithoutRevalidatingExecutionMetadataOrAttachmentExtractionInternals() {
        String payload = """
            {"unknownLegacyField":{"version":1},"budget":"legacy","byokBudget":{"scopeId":"old"},
             "platformBudget":{"maxCostUsd":-1},"modelSelection":{"provider":"RETIRED"},
             "input":{"requirementText":"Original text","workflowMode":"OLD_MODE","legacy":true,
               "attachments":[{"name":"brief.txt","status":"COMPLETE","notice":"읽음",
                 "size":0,"sha256":"legacy","text":null,"unknownExtractionField":true}]}}
            """;
        var turn = readPayload(payload);
        assertThat(turn.requirementText()).isEqualTo("Original text");
        assertThat(turn.originalInputStatus()).isEqualTo(OriginalInputStatus.AVAILABLE);
        assertThat(turn.attachments()).containsExactly(new AgentChatTurn.AttachmentSummary("brief.txt", "COMPLETE", "읽음"));
        // Tolerance is history-only: strict execution deserialization is deliberately unchanged.
        assertThatThrownBy(() -> new ObjectMapper().readValue(payload, InternalAgentRunRequest.class))
            .isInstanceOf(JacksonException.class);
    }

    @ParameterizedTest
    @ValueSource(strings = {"{}", "\"bad\"", "[null]", "[42]", "[{}]", "[{\"name\":7,\"status\":\"COMPLETE\"}]",
        "[{\"name\":\"brief\",\"status\":null}]", "[{\"name\":\"brief\",\"status\":\"COMPLETE\",\"notice\":false}]"})
    void marksMalformedAttachmentMetadataWithoutErasingText(String attachments) {
        var turn = readPayload("{\"input\":{\"requirementText\":\"Retained text\",\"attachments\":" + attachments + "}}");
        assertThat(turn.requirementText()).isEqualTo("Retained text");
        assertThat(turn.originalInputStatus()).isEqualTo(OriginalInputStatus.PARTIAL);
        assertThat(turn.originalInputIssue()).isEqualTo(OriginalInputIssue.INVALID_ATTACHMENTS);
        assertThat(turn.attachments()).isEmpty();
    }

    @Test
    void preservesHealthyAttachmentSummariesBesideMalformedEntries() {
        var turn = readPayload("""
            {"input":{"requirementText":"Retained","attachments":[null,
              {"name":"first.txt","status":"COMPLETE"}, {"name":7},
              {"name":"last.csv","status":"PARTIAL","notice":"Only first sheet"}]}}
            """);
        assertThat(turn.originalInputStatus()).isEqualTo(OriginalInputStatus.PARTIAL);
        assertThat(turn.attachments()).containsExactly(new AgentChatTurn.AttachmentSummary("first.txt", "COMPLETE", null),
            new AgentChatTurn.AttachmentSummary("last.csv", "PARTIAL", "Only first sheet"));
    }

    @Test
    void preservesReadableAttachmentsEvenWhenTextIsMissing() {
        var turn = readPayload("{\"input\":{\"attachments\":[{\"name\":\"brief.txt\",\"status\":\"COMPLETE\"}]}}");
        assertUnavailable(turn, OriginalInputIssue.INVALID_REQUIREMENT_TEXT);
        assertThat(turn.attachments()).hasSize(1);
    }

    @Test
    void logsOnlyRunIdentityAndIssueCategoryNeverPayloadOrParserException() {
        var logger = (Logger) LoggerFactory.getLogger(AgentRunHistoryService.class);
        var appender = new ListAppender<ILoggingEvent>();
        appender.start();
        logger.addAppender(appender);
        try {
            var turn = readPayload("{\"input\":\"PRIVATE_CUSTOMER_TEXT\"");
            assertThat(appender.list).hasSize(1);
            assertThat(appender.list.getFirst().getFormattedMessage())
                .contains(turn.runId().toString(), "MALFORMED_PAYLOAD").doesNotContain("PRIVATE_CUSTOMER_TEXT");
            assertThat(appender.list.getFirst().getThrowableProxy()).isNull();
        } finally {
            logger.detachAppender(appender);
            appender.stop();
        }
    }

    @Test
    void propagatesCommandStorageFailureRatherThanReportingCorruptInput() {
        authorize();
        var run = run(AgentRunStatus.COMPLETED);
        page(20, run);
        var failure = new DataAccessResourceFailureException("database unavailable");
        when(commands.findFirstByRunIdAndCommandTypeOrderByCreatedAtAsc(run.id(), AgentRunCommandType.START)).thenThrow(failure);
        assertThatThrownBy(() -> history.list(user, workspace, project, 20)).isSameAs(failure);
    }

    @Test
    void propagatesRunQueryFailure() {
        authorize();
        var failure = new DataAccessResourceFailureException("database unavailable");
        when(runs.findByWorkspaceIdAndProjectIdOrderByCreatedAtDesc(workspace, project, PageRequest.of(0, 20))).thenThrow(failure);
        assertThatThrownBy(() -> history.list(user, workspace, project, 20)).isSameAs(failure);
        verifyNoInteractions(commands);
    }

    @Test
    void deniesCrossWorkspaceHistoryBeforeReadingProjectsOrCommands() {
        when(permissions.findActiveMembership(user, workspace)).thenReturn(Optional.empty());
        assertStatus(HttpStatus.NOT_FOUND, 20);
        verifyNoInteractions(projects, runs, commands);
    }

    @ParameterizedTest
    @ValueSource(strings = {"AGENT_RUN", "PROJECT_READ"})
    void requiresBothPermissions(String onlyPermission) {
        when(permissions.findActiveMembership(user, workspace)).thenReturn(Optional.of(member(PermissionCode.valueOf(onlyPermission))));
        assertStatus(HttpStatus.FORBIDDEN, 20);
        verifyNoInteractions(projects, runs, commands);
    }

    @Test
    void doesNotReturnHistoryForProjectOutsideAuthorizedWorkspace() {
        when(permissions.findActiveMembership(user, workspace)).thenReturn(Optional.of(member(PermissionCode.AGENT_RUN, PermissionCode.PROJECT_READ)));
        when(projects.findByIdAndWorkspaceId(project, workspace)).thenReturn(Optional.empty());
        assertStatus(HttpStatus.NOT_FOUND, 20);
        verifyNoInteractions(runs, commands);
    }

    @ParameterizedTest
    @ValueSource(ints = {-1, 0, 51, Integer.MAX_VALUE})
    void rejectsInvalidLimitsBeforeAccessingData(int limit) {
        assertStatus(HttpStatus.BAD_REQUEST, limit);
        verifyNoInteractions(permissions, projects, runs, commands);
    }

    @ParameterizedTest
    @ValueSource(ints = {1, 20, 50})
    void preservesBoundedWorkspaceAndProjectScopedQuery(int limit) {
        authorize();
        page(limit);
        assertThat(history.list(user, workspace, project, limit)).isEmpty();
        verify(runs).findByWorkspaceIdAndProjectIdOrderByCreatedAtDesc(workspace, project, PageRequest.of(0, limit));
        verifyNoInteractions(commands);
    }

    private AgentChatTurn readPayload(String text) {
        authorize();
        var run = run(AgentRunStatus.COMPLETED);
        page(20, run);
        payload(run, text);
        return history.list(user, workspace, project, 20).getFirst();
    }

    private void authorize() {
        when(permissions.findActiveMembership(user, workspace)).thenReturn(Optional.of(member(PermissionCode.AGENT_RUN, PermissionCode.PROJECT_READ)));
        when(projects.findByIdAndWorkspaceId(project, workspace)).thenReturn(Optional.of(mock(ProjectEntity.class)));
    }

    private AgentRunEntity run(AgentRunStatus status) {
        var run = mock(AgentRunEntity.class);
        when(run.id()).thenReturn(UUID.randomUUID());
        lenient().when(run.status()).thenReturn(status);
        lenient().when(run.createdAt()).thenReturn(createdAt);
        return run;
    }

    private void page(int limit, AgentRunEntity... items) {
        when(runs.findByWorkspaceIdAndProjectIdOrderByCreatedAtDesc(workspace, project, PageRequest.of(0, limit))).thenReturn(List.of(items));
    }

    private void payload(AgentRunEntity run, String payload) {
        var command = mock(AgentRunCommandEntity.class);
        when(command.payload()).thenReturn(payload);
        when(commands.findFirstByRunIdAndCommandTypeOrderByCreatedAtAsc(run.id(), AgentRunCommandType.START)).thenReturn(Optional.of(command));
    }

    private void assertStatus(HttpStatus status, int limit) {
        assertThatThrownBy(() -> history.list(user, workspace, project, limit))
            .isInstanceOfSatisfying(ResponseStatusException.class, error -> assertThat(error.getStatusCode()).isEqualTo(status));
    }

    private static void assertUnavailable(AgentChatTurn turn, OriginalInputIssue issue) {
        assertThat(turn.requirementText()).isNull();
        assertThat(turn.originalInputStatus()).isEqualTo(OriginalInputStatus.UNAVAILABLE);
        assertThat(turn.originalInputIssue()).isEqualTo(issue);
    }

    private static MembershipPermissions member(PermissionCode... codes) {
        return new MembershipPermissions(UUID.randomUUID(), Set.of(codes));
    }
}
