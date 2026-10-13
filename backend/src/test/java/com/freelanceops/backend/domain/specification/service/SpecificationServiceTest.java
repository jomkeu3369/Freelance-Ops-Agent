package com.freelanceops.backend.domain.specification.service;

import com.freelanceops.backend.domain.memory.dto.response.MemorySourceMessage;
import com.freelanceops.backend.domain.memory.service.ProjectMemoryService;
import com.freelanceops.backend.domain.project.entity.ProjectEntity;
import com.freelanceops.backend.domain.project.repository.ProjectRepository;
import com.freelanceops.backend.domain.specification.dto.request.*;
import com.freelanceops.backend.domain.specification.entity.SpecificationEntity;
import com.freelanceops.backend.domain.specification.model.ConfirmedAnalysisSource;
import com.freelanceops.backend.domain.specification.repository.*;
import com.freelanceops.backend.domain.workspace.policy.*;
import com.freelanceops.backend.domain.workspace.service.WorkspaceAuthorizationService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;
import org.springframework.data.domain.Pageable;
import org.springframework.web.server.ResponseStatusException;
import java.time.Instant;
import java.util.*;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class SpecificationServiceTest {
    final SpecificationRepository repository = mock(SpecificationRepository.class);
    final SpecificationRequestRepository requests = mock(SpecificationRequestRepository.class);
    final ProjectRepository projects = mock(ProjectRepository.class);
    final WorkspaceAuthorizationService authorization = mock(WorkspaceAuthorizationService.class);
    final SpecificationSourceReader sources = mock(SpecificationSourceReader.class);
    final ProjectMemoryService memory = mock(ProjectMemoryService.class);
    final SpecificationKnowledgeWriter knowledge = mock(SpecificationKnowledgeWriter.class);
    final SpecificationPdfRenderer pdf = mock(SpecificationPdfRenderer.class);
    final SpecificationService service = new SpecificationService(repository, requests, projects, authorization, sources, memory, knowledge, pdf);
    final UUID actor = UUID.randomUUID(), workspace = UUID.randomUUID(), projectId = UUID.randomUUID(), decisionId = UUID.randomUUID(), runId = UUID.randomUUID();
    final Map<UUID, SpecificationEntity> saved = new LinkedHashMap<>();
    final Map<UUID, SpecificationRequestRepository.SavedRequest> requestLedger = new HashMap<>();
    final String body = "  사용자 확정 내용\n<script>literal</script>\n미확정 질문은 질문으로 유지  ";
    ProjectEntity project;
    ConfirmedAnalysisSource source;

    @BeforeEach void setup() {
        project = new ProjectEntity(projectId, workspace, "샘플", "원문", "KRW", null, null, null);
        source = new ConfirmedAnalysisSource(decisionId, 1, body, SpecificationText.hash(body), runId, 0,
            List.of(runId + ":LEAN"), Map.of("originalBodyText", "AI 초안", "selectedOpinionIds", List.of(runId + ":LEAN")), actor, Instant.now());
        when(authorization.authorize(eq(actor), eq(workspace), any())).thenReturn(AuthorizationDecision.ALLOWED);
        when(projects.findByIdAndWorkspaceId(projectId, workspace)).thenReturn(Optional.of(project));
        when(projects.findByIdAndWorkspaceIdForUpdate(projectId, workspace)).thenReturn(Optional.of(project));
        when(sources.getConfirmed(actor, workspace, projectId, decisionId)).thenReturn(source);
        when(sources.isLatestConfirmed(actor, workspace, projectId, decisionId)).thenReturn(true);
        when(memory.forRun(workspace, projectId, runId)).thenReturn(List.of(new MemorySourceMessage(UUID.randomUUID(), 1, "RUN_INPUT", "원문", null, Instant.now())));
        when(repository.findByIdAndWorkspaceIdAndProjectId(any(), eq(workspace), eq(projectId))).thenAnswer(call -> Optional.ofNullable(saved.get(call.getArgument(0))));
        when(repository.findTopByWorkspaceIdAndProjectIdOrderByRevisionNumberDesc(workspace, projectId)).thenAnswer(call -> saved.values().stream().max(Comparator.comparingInt(SpecificationEntity::revisionNumber)));
        when(repository.saveAndFlush(any())).thenAnswer(call -> { SpecificationEntity value = call.getArgument(0); saved.put(value.id(), value); return value; });
        when(requests.find(eq(workspace), eq(projectId), any())).thenAnswer(call -> Optional.ofNullable(requestLedger.get(call.getArgument(2))));
        doAnswer(call -> { requestLedger.put(call.getArgument(2), new SpecificationRequestRepository.SavedRequest(call.getArgument(3), call.getArgument(4))); return null; })
            .when(requests).save(eq(workspace), eq(projectId), any(), anyString(), any());
        when(knowledge.store(eq(actor), any(), any())).thenReturn(UUID.randomUUID());
        when(knowledge.indexStatus(eq(workspace), any())).thenReturn("KEYWORD_ONLY");
    }
    @Test void generationOnlyCopiesConfirmedSourceAndStoresNoReusableDraft() {
        var draft = create();
        assertThat(draft.bodyText()).isEqualTo(body);
        assertThat(draft.sourceBodyText()).isEqualTo(body);
        assertThat(draft.sourceProvenance()).containsEntry("originalBodyText", "AI 초안");
        assertThat(draft.status()).isEqualTo("DRAFT"); assertThat(draft.indexStatus()).isEqualTo("NOT_INDEXED");
        assertThat(draft.reusableDocumentId()).isNull(); verifyNoInteractions(knowledge, pdf);
    }
    @Test void generationRetriesAndRepeatedOpeningDoNotDuplicateOrDiscardEdits() {
        UUID requestId = UUID.randomUUID(); var input = new CreateSpecificationRequest(decisionId, requestId);
        var first = service.create(actor, workspace, projectId, input);
        var edited = service.revise(actor, workspace, projectId, first.id(), new ReviseSpecificationRequest(UUID.randomUUID(), first.contentHash(), first.title(), "사용자 수정"));
        assertThat(service.create(actor, workspace, projectId, input).id()).isEqualTo(first.id());
        assertThat(create().id()).isEqualTo(edited.id()); assertThat(saved).hasSize(2);
    }
    @Test void requestIdCannotBeReusedForDifferentOperation() {
        UUID requestId = UUID.randomUUID(); var first = service.create(actor, workspace, projectId, new CreateSpecificationRequest(decisionId, requestId));
        status(409, () -> service.revise(actor, workspace, projectId, first.id(), new ReviseSpecificationRequest(requestId, first.contentHash(), first.title(), "changed")));
        assertThat(saved).hasSize(1);
    }
    @Test void editsCreateNewImmutableRevisionAndRetryReturnsSameRevision() {
        var first = confirm(create()); var input = new ReviseSpecificationRequest(UUID.randomUUID(), first.contentHash(), "새 제목", "  정정된 사용자 내용  ");
        var next = service.revise(actor, workspace, projectId, first.id(), input);
        assertThat(next.revisionNumber()).isEqualTo(2); assertThat(next.supersedes()).isEqualTo(first.id());
        assertThat(next.status()).isEqualTo("DRAFT"); assertThat(next.bodyText()).isEqualTo(input.bodyText());
        assertThat(service.get(actor, workspace, projectId, first.id()).bodyText()).isEqualTo(body);
        assertThat(service.revise(actor, workspace, projectId, first.id(), input).id()).isEqualTo(next.id());
        assertThat(saved).hasSize(2);
    }
    @Test void staleAndOldDraftsCannotBeConfirmedOrReindexed() {
        var first = create();
        var second = service.revise(actor, workspace, projectId, first.id(), new ReviseSpecificationRequest(UUID.randomUUID(), first.contentHash(), first.title(), "새 버전"));
        status(409, () -> confirm(first));
        when(sources.isLatestConfirmed(actor, workspace, projectId, decisionId)).thenReturn(false);
        status(409, () -> confirm(second)); verify(knowledge, never()).store(any(), any(), any());
    }
    @Test void explicitConfirmationAndExactHashAreRequired() {
        var value = create();
        status(400, () -> service.confirm(actor, workspace, projectId, value.id(), new ConfirmSpecificationRequest(value.contentHash(), "yes")));
        status(409, () -> service.confirm(actor, workspace, projectId, value.id(), new ConfirmSpecificationRequest("0".repeat(64), "CONFIRM_SPECIFICATION")));
        verifyNoInteractions(knowledge, pdf);
    }
    @Test void confirmationLocksSourceBeforeCheckingAndIsIdempotent() {
        var draft = create(); clearInvocations(sources);
        var confirmed = confirm(draft);
        assertThat(confirmed.status()).isEqualTo("CONFIRMED"); assertThat(confirmed.indexStatus()).isEqualTo("KEYWORD_ONLY");
        assertThat(confirmed.confirmedBy()).isEqualTo(actor);
        InOrder ordered = inOrder(knowledge, sources);
        ordered.verify(knowledge).lockWorkspace(workspace);
        ordered.verify(sources).isLatestConfirmed(actor, workspace, projectId, decisionId);
        ordered.verify(knowledge).store(eq(actor), any(), any());
        when(sources.isLatestConfirmed(actor, workspace, projectId, decisionId)).thenReturn(false);
        assertThat(confirm(draft).id()).isEqualTo(confirmed.id());
        verify(knowledge, times(1)).store(eq(actor), any(), any());
    }
    @Test void oldConfirmedVersionRemainsDownloadableAndDraftCannotExport() {
        var draft = create(); status(409, () -> service.download(actor, workspace, projectId, draft.id())); verifyNoInteractions(pdf);
        var confirmed = confirm(draft);
        var revision = service.revise(actor, workspace, projectId, confirmed.id(), new ReviseSpecificationRequest(UUID.randomUUID(), confirmed.contentHash(), confirmed.title(), "새 버전"));
        when(sources.isLatestConfirmed(actor, workspace, projectId, decisionId)).thenReturn(false);
        byte[] bytes = "%PDF-actual".getBytes(java.nio.charset.StandardCharsets.US_ASCII);
        when(pdf.render(anyString(), eq(1), eq(body), eq(confirmed.contentHash()), any())).thenReturn(bytes);
        assertThat(service.download(actor, workspace, projectId, confirmed.id()).bytes()).isEqualTo(bytes);
        status(409, () -> service.download(actor, workspace, projectId, revision.id()));
    }
    @Test void otherTenantAndReadOnlyRoleCannotMutate() {
        when(authorization.authorize(actor, workspace, PermissionCode.PROJECT_READ)).thenReturn(AuthorizationDecision.NOT_FOUND);
        status(404, this::create); verifyNoInteractions(repository, requests, sources, knowledge);
        when(authorization.authorize(eq(actor), eq(workspace), any())).thenReturn(AuthorizationDecision.ALLOWED);
        when(authorization.authorize(actor, workspace, PermissionCode.DOCUMENT_WRITE)).thenReturn(AuthorizationDecision.FORBIDDEN);
        status(403, this::create); verifyNoInteractions(repository, requests, sources, knowledge);
    }
    @Test void corruptedSourceAndMissingOriginalsNeverGenerateAnArtifact() {
        when(sources.getConfirmed(actor, workspace, projectId, decisionId)).thenReturn(new ConfirmedAnalysisSource(decisionId, 1, body, "0".repeat(64), runId, 0, List.of(), Map.of(), actor, Instant.now()));
        assertThatThrownBy(this::create).isInstanceOf(IllegalStateException.class);
        when(sources.getConfirmed(actor, workspace, projectId, decisionId)).thenReturn(source);
        when(memory.forRun(workspace, projectId, runId)).thenReturn(List.of()); status(409, this::create);
        assertThat(saved).isEmpty(); verifyNoInteractions(knowledge);
    }
    @Test void historyIsBoundedAndSourceCurrentIncludesSemanticSourceGuard() {
        var first = create(); when(repository.findAllByWorkspaceIdAndProjectIdOrderByRevisionNumberDesc(eq(workspace), eq(projectId), any(Pageable.class))).thenReturn(List.copyOf(saved.values()));
        when(sources.isLatestConfirmed(actor, workspace, projectId, decisionId)).thenReturn(false);
        var history = service.list(actor, workspace, projectId);
        assertThat(history).hasSize(1); assertThat(history.getFirst().sourceCurrent()).isFalse(); assertThat(history.getFirst().id()).isEqualTo(first.id());
        verify(repository).findAllByWorkspaceIdAndProjectIdOrderByRevisionNumberDesc(eq(workspace), eq(projectId), argThat(page -> page.getPageSize() == 50));
    }
    private com.freelanceops.backend.domain.specification.dto.response.SpecificationResponse create() { return service.create(actor, workspace, projectId, new CreateSpecificationRequest(decisionId, UUID.randomUUID())); }
    private com.freelanceops.backend.domain.specification.dto.response.SpecificationResponse confirm(com.freelanceops.backend.domain.specification.dto.response.SpecificationResponse value) { return service.confirm(actor, workspace, projectId, value.id(), new ConfirmSpecificationRequest(value.contentHash(), "CONFIRM_SPECIFICATION")); }
    private void status(int expected, Runnable action) { assertThatThrownBy(action::run).isInstanceOfSatisfying(ResponseStatusException.class, error -> assertThat(error.getStatusCode().value()).isEqualTo(expected)); }
}
