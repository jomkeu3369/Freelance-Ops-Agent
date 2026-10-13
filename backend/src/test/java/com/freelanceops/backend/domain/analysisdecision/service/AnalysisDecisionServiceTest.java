package com.freelanceops.backend.domain.analysisdecision.service;

import com.freelanceops.backend.domain.agentrun.dto.response.AgentRunView;
import com.freelanceops.backend.domain.agentrun.entity.AgentRunEntity;
import com.freelanceops.backend.domain.agentrun.model.AgentRunStatus;
import com.freelanceops.backend.domain.agentrun.model.Provider;
import com.freelanceops.backend.domain.agentrun.repository.AgentRunRepository;
import com.freelanceops.backend.domain.agentrun.service.AgentRunGatewayService;
import com.freelanceops.backend.domain.analysisdecision.dto.request.ConfirmAnalysisDecisionRequest;
import com.freelanceops.backend.domain.analysisdecision.dto.request.CreateAnalysisDecisionRequest;
import com.freelanceops.backend.domain.analysisdecision.dto.request.ReviseAnalysisDecisionRequest;
import com.freelanceops.backend.domain.analysisdecision.dto.response.AnalysisDecisionResponse.OpinionSnapshot;
import com.freelanceops.backend.domain.analysisdecision.entity.AnalysisDecisionEntity;
import com.freelanceops.backend.domain.analysisdecision.repository.AnalysisDecisionRepository;
import com.freelanceops.backend.domain.project.entity.ProjectEntity;
import com.freelanceops.backend.domain.memory.dto.response.MemorySourceMessage;
import com.freelanceops.backend.domain.memory.service.ProjectMemoryService;
import com.freelanceops.backend.domain.project.repository.ProjectRepository;
import com.freelanceops.backend.domain.workspace.policy.AuthorizationDecision;
import com.freelanceops.backend.domain.workspace.policy.PermissionCode;
import com.freelanceops.backend.domain.workspace.service.WorkspaceAuthorizationService;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.web.server.ResponseStatusException;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class AnalysisDecisionServiceTest {
    @Mock AnalysisDecisionRepository decisions;
    @Mock ProjectRepository projects;
    @Mock AgentRunRepository runs;
    @Mock AgentRunGatewayService gateway;
    @Mock WorkspaceAuthorizationService authorization;
    @Mock ProjectMemoryService memory;
    MemorySourceMessage originalSource = new MemorySourceMessage(UUID.randomUUID(), 1, "PROJECT_INPUT", "Original request", null, Instant.now());
    UUID user = UUID.randomUUID(), workspace = UUID.randomUUID(), projectId = UUID.randomUUID(), runId = UUID.randomUUID();
    AnalysisDecisionService service;
    ProjectEntity project;

    @BeforeEach void setup() {
        service = new AnalysisDecisionService(decisions, projects, runs, gateway, authorization, memory);
        project = new ProjectEntity(projectId, workspace, "Review fixture", "Original request", "KRW", null, null, null);
        lenient().when(authorization.authorize(eq(user), eq(workspace), any())).thenReturn(AuthorizationDecision.ALLOWED);
        lenient().when(projects.findByIdAndWorkspaceIdForUpdate(projectId, workspace)).thenReturn(Optional.of(project));
        lenient().when(projects.findByIdAndWorkspaceId(projectId, workspace)).thenReturn(Optional.of(project));
        lenient().when(memory.current(workspace, projectId)).thenReturn(List.of(originalSource));
        lenient().when(memory.forRun(workspace, projectId, runId)).thenReturn(List.of(originalSource, new MemorySourceMessage(UUID.randomUUID(), 2, "RUN_INPUT", "Original request", null, Instant.now())));
        lenient().when(decisions.saveAndFlush(any())).thenAnswer(call -> call.getArgument(0));
    }

    @Test void selectionUsesServerOpinionsAndPreservesDuplicateWorkTradeoffsAndUnansweredQuestions() {
        source(AgentRunStatus.COMPLETED, 0L, "PROJECT_ANALYSIS");
        var created = service.create(user, workspace, projectId, create(List.of(opinion("EXPANDED"), opinion("LEAN"))));
        assertThat(created.status()).isEqualTo("DRAFT");
        assertThat(created.selectedOpinionIds()).containsExactly(opinion("LEAN"), opinion("EXPANDED"));
        assertThat(created.sourceOpinions()).hasSize(2);
        assertThat(created.bodyText()).contains("LEAN tradeoff", "EXPANDED tradeoff", "Original evidence", "Open question?", "의견 출처: " + opinion("LEAN"));
        assertThat(created.bodyText().split("작업 1: Shared feature", -1)).hasSize(3);
        assertThat(created.reviewWarnings()).anyMatch(value -> value.contains("중복 가능 작업"));
        assertThat(created.originalBodyText()).isEqualTo(created.bodyText());
        assertThat(created.contentHash()).isEqualTo(OpinionComposition.hash(created.bodyText()));
        verify(gateway, times(1)).get(eq(user), eq(workspace), eq(runId), anyString());
    }

    @ParameterizedTest @EnumSource(value = AgentRunStatus.class, names = {"QUEUED", "RUNNING", "WAITING_FOR_USER", "PARTIAL", "FAILED", "CANCELLED"})
    void unfinishedOrFailedResultsCannotBecomeAConfirmedSource(AgentRunStatus status) {
        source(status, 0L, "PROJECT_ANALYSIS");
        status(409, () -> service.create(user, workspace, projectId, create(List.of(opinion("LEAN")))));
        verify(decisions, never()).saveAndFlush(any());
    }

    @ParameterizedTest @EnumSource(value = AgentRunStatus.class, names = {"PARTIAL", "FAILED", "CANCELLED"})
    void durableUnsuccessfulOutcomeWinsOverLateCompletedSnapshot(AgentRunStatus terminal) {
        source(AgentRunStatus.COMPLETED, 0L, "PROJECT_ANALYSIS");
        var persisted = run(0L, "PROJECT_ANALYSIS");
        persisted.updateStatus(terminal, Instant.now());
        when(runs.findByIdAndWorkspaceIdForUpdate(runId, workspace)).thenReturn(Optional.of(persisted));
        when(runs.findFirstByWorkspaceIdAndProjectIdAndWorkflowModeOrderByCreatedAtDesc(workspace, projectId, "PROJECT_ANALYSIS"))
            .thenReturn(Optional.of(persisted));
        assertThat(service.latestSource(user, workspace, projectId).orElseThrow().sourceCurrent()).isFalse();
        status(409, () -> service.create(user, workspace, projectId, create(List.of(opinion("LEAN")))));
        verify(decisions, never()).saveAndFlush(any());
    }

    @Test void aRunningSourceCanConvergeToCompletedBeforeCreatingItsDecision() {
        var persisted = run(0L, "PROJECT_ANALYSIS");
        persisted.updateStatus(AgentRunStatus.RUNNING, Instant.now());
        when(runs.findByIdAndWorkspaceIdForUpdate(runId, workspace)).thenReturn(Optional.of(persisted));
        var drafts = List.of(draft("LEAN"), draft("RECOMMENDED"), draft("EXPANDED"));
        when(gateway.get(eq(user), eq(workspace), eq(runId), anyString())).thenAnswer(call -> {
            persisted.synchronizeStatus(AgentRunStatus.COMPLETED, Instant.now());
            return new AgentRunView(runId, AgentRunStatus.COMPLETED, null, null,
                new AgentRunView.AgentRunResult("Summary", List.of(), List.of(), drafts.get(1), drafts), null, null, null, Instant.now());
        });
        assertThat(service.create(user, workspace, projectId, create(List.of(opinion("LEAN")))).status()).isEqualTo("DRAFT");
        assertThat(persisted.status()).isEqualTo(AgentRunStatus.COMPLETED);
    }

    @Test void anUnavailableCompletedPayloadCannotBeSelectedEvenWhenItsVersionAndRootsAreCurrent() {
        var persisted = run(0L, "PROJECT_ANALYSIS");
        when(runs.findByIdAndWorkspaceIdForUpdate(runId, workspace)).thenReturn(Optional.of(persisted));
        when(runs.findFirstByWorkspaceIdAndProjectIdAndWorkflowModeOrderByCreatedAtDesc(workspace, projectId, "PROJECT_ANALYSIS"))
            .thenReturn(Optional.of(persisted));
        when(gateway.get(eq(user), eq(workspace), eq(runId), anyString())).thenReturn(new AgentRunView(runId,
            AgentRunStatus.COMPLETED, null, null, null, null, null, null, Instant.now()));
        assertThat(service.latestSource(user, workspace, projectId).orElseThrow().sourceCurrent()).isFalse();
        status(409, () -> service.create(user, workspace, projectId, create(List.of(opinion("LEAN")))));
        verify(decisions, never()).saveAndFlush(any());
    }

    @Test void sourceReadReportsSemanticFreshnessWithoutTakingAProjectWriteLock() {
        var drafts = List.of(draft("LEAN"), draft("RECOMMENDED"), draft("EXPANDED"));
        when(gateway.get(eq(user), eq(workspace), eq(runId), anyString())).thenReturn(new AgentRunView(runId, AgentRunStatus.COMPLETED, null, null,
            new AgentRunView.AgentRunResult("Summary", List.of(), List.of(), drafts.get(1), drafts), null, null, null, Instant.now()));
        var run = run(0L, "PROJECT_ANALYSIS");
        when(runs.findFirstByWorkspaceIdAndProjectIdAndWorkflowModeOrderByCreatedAtDesc(workspace, projectId, "PROJECT_ANALYSIS"))
            .thenReturn(Optional.of(run));
        assertThat(service.latestSource(user, workspace, projectId).orElseThrow().sourceCurrent()).isTrue();
        when(memory.current(workspace, projectId)).thenReturn(List.of(originalSource,
            new MemorySourceMessage(UUID.randomUUID(), 3, "USER_CLARIFICATION", "Later unrelated answer", null, Instant.now())));
        assertThat(service.latestSource(user, workspace, projectId).orElseThrow().sourceCurrent()).isFalse();
        verify(projects, never()).findByIdAndWorkspaceIdForUpdate(any(), any());
    }

    @Test void anUnselectedMalformedPerspectiveRejectsTheEntireCompletedSource() {
        when(runs.findByIdAndWorkspaceIdForUpdate(runId, workspace)).thenReturn(Optional.of(run(0L, "PROJECT_ANALYSIS")));
        var drafts = List.of(draft("LEAN"), draft("RECOMMENDED"), new AgentRunView.QuotationDraft("EXPANDED", List.of(), null));
        when(gateway.get(eq(user), eq(workspace), eq(runId), anyString())).thenReturn(new AgentRunView(runId, AgentRunStatus.COMPLETED, null, null,
            new AgentRunView.AgentRunResult("Summary", List.of(), List.of(), drafts.get(1), drafts), null, null, null, Instant.now()));
        status(409, () -> service.create(user, workspace, projectId, create(List.of(opinion("LEAN")))));
        verify(decisions, never()).saveAndFlush(any());
    }

    @Test void aFullModeLabelCannotBindADifferentRunInputToTheOriginalInquiry() {
        when(runs.findByIdAndWorkspaceIdForUpdate(runId, workspace)).thenReturn(Optional.of(run(0L, "PROJECT_ANALYSIS")));
        when(memory.forRun(workspace, projectId, runId)).thenReturn(List.of(originalSource,
            new MemorySourceMessage(UUID.randomUUID(), 2, "RUN_INPUT", "An unrelated chat question", null, Instant.now())));
        status(409, () -> service.create(user, workspace, projectId, create(List.of(opinion("LEAN")))));
        verifyNoInteractions(gateway);
        verify(decisions, never()).saveAndFlush(any());
    }

    @Test void legacyAndAdHocRunsCannotPretendToHaveTheFullWorkflow() {
        var run = run(null, "AD_HOC");
        when(runs.findByIdAndWorkspaceIdForUpdate(runId, workspace)).thenReturn(Optional.of(run));
        status(409, () -> service.create(user, workspace, projectId, create(List.of(opinion("LEAN")))));
        verifyNoInteractions(gateway);
    }

    @Test void changedProjectsAndForeignRunsAreRejectedBeforeTheAgentRead() {
        when(runs.findByIdAndWorkspaceIdForUpdate(runId, workspace)).thenReturn(Optional.of(run(1L, "PROJECT_ANALYSIS")));
        status(409, () -> service.create(user, workspace, projectId, create(List.of(opinion("LEAN")))));
        when(runs.findByIdAndWorkspaceIdForUpdate(runId, workspace)).thenReturn(Optional.of(new AgentRunEntity(runId,
            workspace, UUID.randomUUID(), UUID.randomUUID(), user, Provider.OPENAI, "fixture", AgentRunStatus.COMPLETED, Instant.now())));
        status(404, () -> service.create(user, workspace, projectId, create(List.of(opinion("LEAN")))));
        verifyNoInteractions(gateway);
    }

    @Test void duplicateAndUnknownOpinionIdentitiesDoNotSilentlyDeduplicateOrSubstitute() {
        status(400, () -> service.create(user, workspace, projectId, create(List.of(opinion("LEAN"), opinion("LEAN")))));
        source(AgentRunStatus.COMPLETED, 0L, "PROJECT_ANALYSIS");
        status(400, () -> service.create(user, workspace, projectId, create(List.of(UUID.randomUUID() + ":LEAN"))));
        verify(decisions, never()).saveAndFlush(any());
    }

    @Test void userEditsCreateAnImmutableRevisionWithTheOriginalCompositionStillAvailable() {
        var original = entity();
        existing(original);
        when(decisions.findTopByWorkspaceIdAndProjectIdAndFamilyIdOrderByVersionNumberDesc(workspace, projectId, original.familyId())).thenReturn(Optional.of(original));
        var edited = service.revise(user, workspace, projectId, original.id(), new ReviseAnalysisDecisionRequest(UUID.randomUUID(), original.contentHash(), "User selected the smaller scope"));
        assertThat(edited.versionNumber()).isEqualTo(2);
        assertThat(edited.previousId()).isEqualTo(original.id());
        assertThat(edited.familyId()).isEqualTo(original.familyId());
        assertThat(edited.bodyOrigin()).isEqualTo("USER_EDITED");
        assertThat(edited.originalBodyText()).isEqualTo(original.bodyText());
        assertThat(original.bodyText()).isEqualTo("Original composition");
        assertThat(original.status()).isEqualTo("DRAFT");
    }

    @Test void confirmationRequiresReviewedHashLatestRevisionAndExplicitConfirmation() {
        var original = entity(); existing(original);
        status(400, () -> service.confirm(user, workspace, projectId, original.id(), new ConfirmAnalysisDecisionRequest(original.contentHash(), "yes")));
        status(409, () -> service.confirm(user, workspace, projectId, original.id(), confirm("0".repeat(64))));
        var next = original.revised(UUID.randomUUID(), "Edited", OpinionComposition.hash("Edited"), UUID.randomUUID(), "operation", user, Instant.now());
        when(decisions.findTopByWorkspaceIdAndProjectIdAndFamilyIdOrderByVersionNumberDesc(workspace, projectId, original.familyId())).thenReturn(Optional.of(next));
        status(409, () -> service.confirm(user, workspace, projectId, original.id(), confirm(original.contentHash())));
        assertThat(original.status()).isEqualTo("DRAFT");
        verify(decisions, never()).saveAndFlush(any());
    }

    @Test void confirmationRetriesKeepTheFirstActorAndTimestampAndUnconfirmedReadsAreRejected() {
        var original = entity(); existing(original);
        status(409, () -> service.getConfirmed(user, workspace, projectId, original.id()));
        when(decisions.findTopByWorkspaceIdAndProjectIdAndFamilyIdOrderByVersionNumberDesc(workspace, projectId, original.familyId())).thenReturn(Optional.of(original));
        var confirmed = service.confirm(user, workspace, projectId, original.id(), confirm(original.contentHash()));
        var retried = service.confirm(user, workspace, projectId, original.id(), confirm(original.contentHash()));
        assertThat(retried).isEqualTo(confirmed);
        assertThat(service.getConfirmed(user, workspace, projectId, original.id()).status()).isEqualTo("CONFIRMED");
        verify(decisions, times(1)).saveAndFlush(any());
    }

    @Test void noPermissionDoesNotReadTheProjectOrSource() {
        when(authorization.authorize(user, workspace, PermissionCode.PROJECT_WRITE)).thenReturn(AuthorizationDecision.FORBIDDEN);
        status(403, () -> service.create(user, workspace, projectId, create(List.of(opinion("LEAN")))));
        verifyNoInteractions(projects, runs, gateway, decisions);
    }

    @Test void idempotentCreateReturnsTheOriginalArtifactWithoutAnotherSourceRead() {
        var original = entity();
        UUID requestId = UUID.randomUUID();
        String operationHash = OpinionComposition.hash("CREATE\n" + runId + "\n0\n" + opinion("LEAN"));
        var replay = new AnalysisDecisionEntity(original.id(), workspace, projectId, runId, 0,
            original.response().sourceOpinions(), List.of(), "summary", List.of(), List.of(), List.of(originalSource), 1, "body",
            OpinionComposition.hash("body"), requestId, operationHash, user, Instant.now());
        when(decisions.findByWorkspaceIdAndProjectIdAndCreatedByAndRequestId(workspace, projectId, user, requestId)).thenReturn(Optional.of(replay));
        assertThat(service.create(user, workspace, projectId, new CreateAnalysisDecisionRequest(requestId, runId, 0, List.of(opinion("LEAN")))).id()).isEqualTo(replay.id());
        status(409, () -> service.create(user, workspace, projectId, new CreateAnalysisDecisionRequest(requestId, runId, 0, List.of(opinion("EXPANDED")))));
        verifyNoInteractions(runs, gateway);
    }

    private void source(AgentRunStatus status, Long version, String mode) {
        when(runs.findByIdAndWorkspaceIdForUpdate(runId, workspace)).thenReturn(Optional.of(run(version, mode)));
        var drafts = List.of(draft("LEAN"), draft("RECOMMENDED"), draft("EXPANDED"));
        when(gateway.get(eq(user), eq(workspace), eq(runId), anyString())).thenReturn(new AgentRunView(runId, status, null, null,
            new AgentRunView.AgentRunResult("Summary", List.of("Open question?"), List.of(), drafts.get(1), drafts), null, null, null, Instant.now()));
    }

    private AgentRunEntity run(Long version, String mode) {
        var run = new AgentRunEntity(runId, workspace, projectId, UUID.randomUUID(), user, Provider.OPENAI, "fixture", AgentRunStatus.COMPLETED, Instant.now());
        if (version != null) run.bindProjectSource(version, mode);
        return run;
    }
    private AgentRunView.QuotationDraft draft(String scenario) {
        return new AgentRunView.QuotationDraft(scenario, List.of(new AgentRunView.QuotationDraftItem("Shared feature", "Description", 2, "DAY", null,
            new AgentRunView.QuotationDraftBasis("EVIDENCE", "Original evidence", "source-message-1", "Client original"))),
            new AgentRunView.PetPerspective(scenario + " proposal", scenario + " rationale", scenario + " tradeoff"));
    }
    private AnalysisDecisionEntity entity() {
        return new AnalysisDecisionEntity(UUID.randomUUID(), workspace, projectId, runId, 0,
            List.of(new OpinionSnapshot(opinion("LEAN"), "LEAN", draft("LEAN"))), List.of(), "summary", List.of(), List.of(),
            List.of(originalSource), 1, "Original composition", OpinionComposition.hash("Original composition"), UUID.randomUUID(), "operation", user, Instant.now());
    }
    private void existing(AnalysisDecisionEntity entity) { when(decisions.findByIdAndWorkspaceIdAndProjectId(entity.id(), workspace, projectId)).thenReturn(Optional.of(entity)); }
    private String opinion(String scenario) { return runId + ":" + scenario; }
    private CreateAnalysisDecisionRequest create(List<String> ids) { return new CreateAnalysisDecisionRequest(UUID.randomUUID(), runId, 0, ids); }
    private ConfirmAnalysisDecisionRequest confirm(String hash) { return new ConfirmAnalysisDecisionRequest(hash, "CONFIRM_ANALYSIS_DECISION"); }
    private void status(int expected, Runnable call) { assertThatThrownBy(call::run).isInstanceOfSatisfying(ResponseStatusException.class, error -> assertThat(error.getStatusCode().value()).isEqualTo(expected)); }
}
