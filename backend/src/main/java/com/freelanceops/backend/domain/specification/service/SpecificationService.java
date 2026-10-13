package com.freelanceops.backend.domain.specification.service;

import com.freelanceops.backend.domain.memory.service.ProjectMemoryService;
import com.freelanceops.backend.domain.project.entity.ProjectEntity;
import com.freelanceops.backend.domain.project.repository.ProjectRepository;
import com.freelanceops.backend.domain.specification.dto.request.*;
import com.freelanceops.backend.domain.specification.dto.response.SpecificationResponse;
import com.freelanceops.backend.domain.specification.dto.response.SpecificationSummaryResponse;
import com.freelanceops.backend.domain.specification.entity.SpecificationEntity;
import com.freelanceops.backend.domain.specification.repository.SpecificationRepository;
import com.freelanceops.backend.domain.specification.repository.SpecificationRequestRepository;
import com.freelanceops.backend.domain.workspace.policy.AuthorizationDecision;
import com.freelanceops.backend.domain.workspace.policy.PermissionCode;
import com.freelanceops.backend.domain.workspace.service.WorkspaceAuthorizationService;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import java.io.UncheckedIOException;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;

@Service
public class SpecificationService {
    private final SpecificationRepository specifications;
    private final SpecificationRequestRepository requests;
    private final ProjectRepository projects;
    private final WorkspaceAuthorizationService authorization;
    private final SpecificationSourceReader sources;
    private final ProjectMemoryService memory;
    private final SpecificationKnowledgeWriter knowledge;
    private final SpecificationPdfRenderer pdf;

    public SpecificationService(SpecificationRepository specifications, SpecificationRequestRepository requests,
                                ProjectRepository projects, WorkspaceAuthorizationService authorization,
                                SpecificationSourceReader sources, ProjectMemoryService memory,
                                SpecificationKnowledgeWriter knowledge, SpecificationPdfRenderer pdf) {
        this.specifications = specifications; this.requests = requests; this.projects = projects;
        this.authorization = authorization; this.sources = sources; this.memory = memory;
        this.knowledge = knowledge; this.pdf = pdf;
    }

    @Transactional(readOnly = true)
    public List<SpecificationSummaryResponse> list(UUID actor, UUID workspace, UUID projectId) {
        authorizeRead(actor, workspace);
        ProjectEntity project = project(workspace, projectId, false);
        var currentSources = new java.util.HashMap<UUID, Boolean>();
        return specifications.findAllByWorkspaceIdAndProjectIdOrderByRevisionNumberDesc(workspace, projectId, PageRequest.of(0, 50))
            .stream().map(value -> new SpecificationSummaryResponse(value.id(), value.revisionNumber(), value.status(), value.title(),
                value.contentHash(), value.sourceDecisionId(), value.sourceDecisionVersion(),
                project.version() == value.sourceProjectVersion() && currentSources.computeIfAbsent(value.sourceDecisionId(), id ->
                    sources.isLatestConfirmed(actor, workspace, projectId, id)),
                value.createdAt(), value.confirmedAt())).toList();
    }

    @Transactional(readOnly = true)
    public SpecificationResponse get(UUID actor, UUID workspace, UUID projectId, UUID id) {
        authorizeRead(actor, workspace);
        ProjectEntity project = project(workspace, projectId, false);
        SpecificationEntity specification = find(workspace, projectId, id);
        return response(specification, current(actor, project, specification));
    }

    @Transactional
    public SpecificationResponse create(UUID actor, UUID workspace, UUID projectId, CreateSpecificationRequest request) {
        authorizeWrite(actor, workspace);
        ProjectEntity project = project(workspace, projectId, true);
        String operationHash = SpecificationText.hash("create:" + request.decisionId());
        SpecificationEntity replay = replay(workspace, projectId, request.requestId(), operationHash);
        if (replay != null) return response(replay, current(actor, project, replay));
        var source = sources.getConfirmed(actor, workspace, projectId, request.decisionId());
        if (project.version() != source.projectVersion() || !sources.isLatestConfirmed(actor, workspace, projectId, source.decisionId()))
            throw conflict("a newer confirmed result or source exists; generate from the latest result");
        if (!SpecificationText.hash(source.bodyText()).equals(source.contentHash()))
            throw new IllegalStateException("confirmed analysis source hash does not match its content");
        SpecificationEntity latest = latest(workspace, projectId);
        // Opening generation again never discards edits or creates duplicate copies.
        if (latest != null && source.decisionId().equals(latest.sourceDecisionId())) {
            requests.save(workspace, projectId, request.requestId(), operationHash, latest.id());
            return response(latest, current(actor, project, latest));
        }
        String title = project.title() + " 명세서";
        if (title.length() > 300) title = project.title();
        SpecificationText.validate(title, source.bodyText());
        var originalSources = memory.forRun(workspace, projectId, source.runId());
        if (originalSources.isEmpty()) throw conflict("original source messages are unavailable; regenerate the analysis");
        SpecificationEntity draft = new SpecificationEntity(UUID.randomUUID(), workspace, projectId,
            latest == null ? 1 : latest.revisionNumber() + 1, latest == null ? null : latest.id(),
            title, source.bodyText(), source.contentHash(), source, originalSources, actor, now());
        specifications.saveAndFlush(draft);
        requests.save(workspace, projectId, request.requestId(), operationHash, draft.id());
        return response(draft, current(actor, project, draft));
    }

    @Transactional
    public SpecificationResponse revise(UUID actor, UUID workspace, UUID projectId, UUID id, ReviseSpecificationRequest request) {
        authorizeWrite(actor, workspace);
        ProjectEntity project = project(workspace, projectId, true);
        SpecificationText.validate(request.title(), request.bodyText());
        String operationHash = SpecificationText.hash("revise:" + id + ":" + request.expectedContentHash()
            + ":" + SpecificationText.hash(request.title()) + ":" + SpecificationText.hash(request.bodyText()));
        SpecificationEntity replay = replay(workspace, projectId, request.requestId(), operationHash);
        if (replay != null) return response(replay, current(actor, project, replay));
        SpecificationEntity previous = find(workspace, projectId, id);
        requireHash(previous, request.expectedContentHash());
        requireLatest(previous);
        SpecificationEntity result = previous;
        if (!request.title().equals(previous.title()) || !request.bodyText().equals(previous.bodyText())) {
            result = new SpecificationEntity(UUID.randomUUID(), workspace, projectId, previous.revisionNumber() + 1,
                previous.id(), request.title(), request.bodyText(), SpecificationText.hash(request.bodyText()),
                previous.source(), previous.originalSources(), actor, now());
            specifications.saveAndFlush(result);
        }
        requests.save(workspace, projectId, request.requestId(), operationHash, result.id());
        return response(result, current(actor, project, result));
    }

    @Transactional
    public SpecificationResponse confirm(UUID actor, UUID workspace, UUID projectId, UUID id, ConfirmSpecificationRequest request) {
        authorizeWrite(actor, workspace);
        if (!"CONFIRM_SPECIFICATION".equals(request.confirmation()))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "explicit specification confirmation is required");
        ProjectEntity project = project(workspace, projectId, true);
        SpecificationEntity specification = find(workspace, projectId, id);
        requireHash(specification, request.expectedContentHash());
        // Lost responses are safe to retry, even after a newer revision is created.
        if ("CONFIRMED".equals(specification.status())) return response(specification, current(actor, project, specification));
        requireLatest(specification);
        // Source append/invalidation also takes this lock. Check the source after
        // acquiring it, so a concurrent correction cannot be re-indexed as truth.
        knowledge.lockWorkspace(workspace);
        if (!current(actor, project, specification)) throw conflict("confirmed result or project source changed; generate a new specification");
        SpecificationText.validate(specification.title(), specification.bodyText());
        Instant now = now();
        UUID documentId = knowledge.store(actor, specification, now);
        specification.confirm(actor, documentId, now);
        specifications.saveAndFlush(specification);
        return response(specification, true);
    }

    @Transactional(readOnly = true)
    public PdfFile download(UUID actor, UUID workspace, UUID projectId, UUID id) {
        authorizeRead(actor, workspace);
        project(workspace, projectId, false);
        SpecificationEntity specification = find(workspace, projectId, id);
        if (!"CONFIRMED".equals(specification.status())) throw conflict("confirm the specification before PDF export");
        byte[] bytes;
        try {
            bytes = pdf.render(specification.title(), specification.revisionNumber(), specification.bodyText(),
                specification.contentHash(), specification.confirmedAt());
        } catch (SpecificationPdfRenderer.PdfLimitExceededException error) {
            throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_CONTENT,
                "PDF는 100페이지 이하로 출력할 수 있습니다. 새 명세 버전에서 범위나 줄바꿈을 조정한 뒤 다시 확정해 주세요. 기존 확정 내용은 보존됩니다.", error);
        } catch (UncheckedIOException error) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
                "PDF 출력 준비가 되어 있지 않습니다. 확정 내용은 보존되며 출력 준비 후 다시 시도할 수 있습니다.", error);
        }
        return new PdfFile(bytes, SpecificationText.downloadName(specification.title(), specification.revisionNumber()), specification.contentHash());
    }

    private SpecificationEntity replay(UUID workspace, UUID projectId, UUID requestId, String operationHash) {
        var saved = requests.find(workspace, projectId, requestId);
        if (saved.isEmpty()) return null;
        if (!saved.get().operationHash().equals(operationHash)) throw conflict("request ID was already used for different specification content");
        return find(workspace, projectId, saved.get().specificationId());
    }

    private boolean current(UUID actor, ProjectEntity project, SpecificationEntity value) {
        return project.version() == value.sourceProjectVersion()
            && sources.isLatestConfirmed(actor, project.workspaceId(), project.id(), value.sourceDecisionId());
    }
    private void requireLatest(SpecificationEntity value) {
        SpecificationEntity newest = latest(value.workspaceId(), value.projectId());
        if (newest == null || !newest.id().equals(value.id())) throw conflict("a newer specification revision exists; reload before editing or confirming");
    }
    private static void requireHash(SpecificationEntity value, String expectedHash) {
        if (!value.contentHash().equals(expectedHash)) throw conflict("specification content changed; reload before continuing");
    }
    private SpecificationEntity latest(UUID workspace, UUID projectId) {
        return specifications.findTopByWorkspaceIdAndProjectIdOrderByRevisionNumberDesc(workspace, projectId).orElse(null);
    }
    private SpecificationEntity find(UUID workspace, UUID projectId, UUID id) {
        return specifications.findByIdAndWorkspaceIdAndProjectId(id, workspace, projectId)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
    }
    private ProjectEntity project(UUID workspace, UUID projectId, boolean lock) {
        ProjectEntity value = (lock ? projects.findByIdAndWorkspaceIdForUpdate(projectId, workspace)
            : projects.findByIdAndWorkspaceId(projectId, workspace)).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        value.requireNotDeleting();
        return value;
    }
    private void authorizeRead(UUID actor, UUID workspace) {
        authorize(actor, workspace, PermissionCode.PROJECT_READ);
        authorize(actor, workspace, PermissionCode.DOCUMENT_READ);
    }
    private void authorizeWrite(UUID actor, UUID workspace) {
        authorizeRead(actor, workspace);
        authorize(actor, workspace, PermissionCode.PROJECT_WRITE);
        authorize(actor, workspace, PermissionCode.DOCUMENT_WRITE);
    }
    private void authorize(UUID actor, UUID workspace, PermissionCode permission) {
        AuthorizationDecision decision = authorization.authorize(actor, workspace, permission);
        if (decision == AuthorizationDecision.NOT_FOUND) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        if (decision == AuthorizationDecision.FORBIDDEN) throw new ResponseStatusException(HttpStatus.FORBIDDEN);
    }
    private static ResponseStatusException conflict(String reason) { return new ResponseStatusException(HttpStatus.CONFLICT, reason); }
    // PostgreSQL stores microseconds; the first response and later retries must agree.
    private static Instant now() { return Instant.now().truncatedTo(ChronoUnit.MICROS); }

    private SpecificationResponse response(SpecificationEntity value, boolean sourceCurrent) {
        return new SpecificationResponse(value.id(), value.workspaceId(), value.projectId(), value.revisionNumber(), value.supersedes(),
            value.status(), value.title(), value.bodyText(), value.contentHash(), value.sourceDecisionId(), value.sourceDecisionVersion(),
            value.sourceDecisionHash(), value.sourceBodyText(), value.sourceRunId(), value.sourceProjectVersion(), value.sourceProvenance(),
            value.originalSources(), value.createdBy(), value.createdAt(), value.confirmedBy(), value.confirmedAt(), value.reusableDocumentId(),
            "CONFIRMED".equals(value.status()) ? knowledge.indexStatus(value.workspaceId(), value.reusableDocumentId()) : "NOT_INDEXED", sourceCurrent,
            SpecificationText.downloadName(value.title(), value.revisionNumber()));
    }
    public record PdfFile(byte[] bytes, String fileName, String contentHash) {}
}
