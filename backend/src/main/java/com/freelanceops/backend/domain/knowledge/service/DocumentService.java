package com.freelanceops.backend.domain.knowledge.service;

import com.freelanceops.backend.domain.knowledge.dto.request.CreateDocumentRequest;
import com.freelanceops.backend.domain.knowledge.dto.request.DocumentChunkRequest;
import com.freelanceops.backend.domain.knowledge.dto.response.DocumentChunkResponse;
import com.freelanceops.backend.domain.knowledge.dto.response.DocumentResponse;
import com.freelanceops.backend.domain.knowledge.entity.DocumentChunkEntity;
import com.freelanceops.backend.domain.knowledge.entity.DocumentEntity;
import com.freelanceops.backend.domain.knowledge.model.KnowledgeSourceType;
import com.freelanceops.backend.domain.knowledge.repository.DocumentChunkRepository;
import com.freelanceops.backend.domain.knowledge.repository.DocumentRepository;
import com.freelanceops.backend.domain.memory.dto.response.MemorySourceMessage;
import com.freelanceops.backend.domain.memory.service.ProjectMemoryService;
import com.freelanceops.backend.domain.project.repository.ProjectRepository;
import com.freelanceops.backend.domain.workspace.policy.AuthorizationDecision;
import com.freelanceops.backend.domain.workspace.policy.PermissionCode;
import com.freelanceops.backend.domain.workspace.service.WorkspaceAuthorizationService;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;

@Service
public class DocumentService {
    @PersistenceContext private EntityManager entityManager;
    private final DocumentRepository documentRepository;
    private final DocumentChunkRepository chunkRepository;
    private final WorkspaceAuthorizationService authorizationService;
    private final RaptorIndexTransactions raptorIndexTransactions;
    private final ProjectMemoryService projectMemory;
    private final ProjectRepository projectRepository;

    public DocumentService(
            DocumentRepository documentRepository,
            DocumentChunkRepository chunkRepository,
            WorkspaceAuthorizationService authorizationService,
            RaptorIndexTransactions raptorIndexTransactions,
            ProjectMemoryService projectMemory,
            ProjectRepository projectRepository) {
        this.documentRepository = documentRepository;
        this.chunkRepository = chunkRepository;
        this.authorizationService = authorizationService;
        this.raptorIndexTransactions = raptorIndexTransactions;
        this.projectMemory = projectMemory;
        this.projectRepository = projectRepository;
    }

    @Transactional(readOnly = true)
    public List<DocumentResponse> list(UUID userId, UUID workspaceId) {
        authorize(userId, workspaceId, PermissionCode.DOCUMENT_READ);
        return documentRepository
                .findAllByWorkspaceIdAndStatusOrderByCreatedAtDesc(workspaceId, "ACTIVE")
                .stream()
                .map(document -> response(document, List.of()))
                .toList();
    }

    @Transactional(readOnly = true)
    public DocumentResponse get(UUID userId, UUID workspaceId, UUID documentId) {
        authorize(userId, workspaceId, PermissionCode.DOCUMENT_READ);
        DocumentEntity document = find(workspaceId, documentId);
        return response(
                document,
                chunkRepository.findAllByWorkspaceIdAndDocumentIdOrderByChunkIndex(
                        workspaceId, documentId));
    }

    @Transactional
    public DocumentResponse create(UUID userId, UUID workspaceId, CreateDocumentRequest request) {
        authorize(userId, workspaceId, PermissionCode.DOCUMENT_WRITE);
        validateChunks(request.chunks());
        raptorIndexTransactions.invalidateActiveSnapshot(workspaceId);
        UUID documentId = UUID.randomUUID();
        Instant now = Instant.now();
        String hash = hashContent(request.chunks());
        DocumentEntity document;
        try {
            document =
                    documentRepository.saveAndFlush(
                            new DocumentEntity(
                                    documentId,
                                    workspaceId,
                                    request.sourceType().name(),
                                    request.title().trim(),
                                    trim(request.sourceUri()),
                                    trim(request.sourceVersion()),
                                    trim(request.jurisdiction()),
                                    request.effectiveFrom(),
                                    request.effectiveUntil(),
                                    hash,
                                    userId,
                                    now));
        } catch (DataIntegrityViolationException error) {
            if (causedBy(error, "uq_document_workspace_hash")) {
                throw new ResponseStatusException(
                        HttpStatus.CONFLICT,
                        "a document with the same content already exists",
                        error);
            }
            throw error;
        }
        List<DocumentChunkEntity> chunks = new ArrayList<>();
        for (int index = 0; index < request.chunks().size(); index++) {
            DocumentChunkRequest chunk = request.chunks().get(index);
            chunks.add(
                    new DocumentChunkEntity(
                            UUID.randomUUID(),
                            workspaceId,
                            documentId,
                            index,
                            chunk.content().trim(),
                            embedding(chunk.embedding()),
                            trim(chunk.embeddingModel()),
                            chunk.startOffset(),
                            chunk.endOffset(),
                            now));
        }
        chunkRepository.saveAll(chunks);
        return response(document, chunks);
    }

    @Transactional
    public DocumentResponse confirm(
            UUID userId, UUID workspaceId, UUID documentId, long expectedVersion) {
        authorize(userId, workspaceId, PermissionCode.DOCUMENT_WRITE);
        DocumentEntity document = find(workspaceId, documentId);
        if (document.projectId() != null) {
            authorize(userId, workspaceId, PermissionCode.AGENT_RUN);
            projectRepository
                    .findByIdAndWorkspaceIdForUpdate(document.projectId(), workspaceId)
                    .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND))
                    .requireNotDeleting();
        }
        raptorIndexTransactions.lockWorkspace(workspaceId);
        entityManager.refresh(document);
        if (document.version() != expectedVersion)
            throw new ResponseStatusException(
                    HttpStatus.CONFLICT, "document changed; reload before confirmation");
        if ("superseded".equals(document.confirmationStatus()))
            throw new ResponseStatusException(
                    HttpStatus.CONFLICT, "source changed; regenerate the document");
        if ("agent".equals(document.origin())) {
            var sources =
                    projectMemory.resolve(
                            workspaceId,
                            document.projectId(),
                            List.of(document.sourceMessageIds()));
            long currentOrder =
                    projectMemory.current(workspaceId, document.projectId()).stream()
                            .mapToLong(MemorySourceMessage::eventOrder)
                            .max()
                            .orElse(0);
            if (sources.size() != document.sourceMessageIds().length
                    || document.sourceEventOrder() == null
                    || currentOrder != document.sourceEventOrder())
                throw new ResponseStatusException(
                        HttpStatus.CONFLICT,
                        "original sources changed; regenerate before confirmation");
        }
        if (!document.retrievalEligible()) {
            raptorIndexTransactions.invalidateActiveSnapshot(workspaceId);
            DocumentEntity previous = null;
            if ("agent".equals(document.origin())) {
                var existing =
                        documentRepository
                                .findAllByWorkspaceIdAndProjectIdAndOrigin(
                                        workspaceId, document.projectId(), "agent")
                                .stream()
                                .filter(value -> value.confirmedAt() != null)
                                .toList();
                previous =
                        existing.stream()
                                .max(Comparator.comparingInt(DocumentEntity::revisionNumber))
                                .orElse(null);
                if (previous != null && runOrder(previous) > runOrder(document))
                    throw new ResponseStatusException(
                            HttpStatus.CONFLICT, "a newer run is already confirmed");
                existing.forEach(value -> value.supersede(Instant.now()));
            }
            document.confirm(userId, Instant.now(), previous);
            documentRepository.saveAndFlush(document);
        }
        return response(
                document,
                chunkRepository.findAllByWorkspaceIdAndDocumentIdOrderByChunkIndex(
                        workspaceId, documentId));
    }

    @Transactional
    public void archive(UUID userId, UUID workspaceId, UUID documentId) {
        authorize(userId, workspaceId, PermissionCode.DOCUMENT_DELETE);
        raptorIndexTransactions.invalidateActiveSnapshot(workspaceId);
        DocumentEntity document = find(workspaceId, documentId);
        document.archive(Instant.now());
        documentRepository.save(document);
    }

    private long runOrder(DocumentEntity document) {
        return projectMemory
                .resolve(
                        document.workspaceId(),
                        document.projectId(),
                        List.of(document.sourceMessageIds()))
                .stream()
                .filter(source -> "RUN_INPUT".equals(source.kind()))
                .mapToLong(MemorySourceMessage::eventOrder)
                .max()
                .orElse(0);
    }

    private DocumentEntity find(UUID workspaceId, UUID documentId) {
        return documentRepository
                .findByIdAndWorkspaceId(documentId, workspaceId)
                .filter(document -> "ACTIVE".equals(document.status()))
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
    }

    private void authorize(UUID userId, UUID workspaceId, PermissionCode permission) {
        AuthorizationDecision decision =
                authorizationService.authorize(userId, workspaceId, permission);
        if (decision == AuthorizationDecision.NOT_FOUND)
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        if (decision == AuthorizationDecision.FORBIDDEN)
            throw new ResponseStatusException(HttpStatus.FORBIDDEN);
    }

    private static void validateChunks(List<DocumentChunkRequest> chunks) {
        for (DocumentChunkRequest chunk : chunks) {
            if ((chunk.embedding() == null)
                    != (chunk.embeddingModel() == null || chunk.embeddingModel().isBlank())) {
                throw new ResponseStatusException(
                        HttpStatus.BAD_REQUEST,
                        "embedding and embeddingModel must be supplied together");
            }
            if (chunk.startOffset() != null
                    && chunk.endOffset() != null
                    && chunk.startOffset() > chunk.endOffset()) {
                throw new ResponseStatusException(
                        HttpStatus.BAD_REQUEST, "chunk startOffset must not exceed endOffset");
            }
        }
    }

    private static String hashContent(List<DocumentChunkRequest> chunks) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            chunks.forEach(
                    chunk ->
                            digest.update(chunk.content().trim().getBytes(StandardCharsets.UTF_8)));
            return java.util.HexFormat.of().formatHex(digest.digest());
        } catch (NoSuchAlgorithmException error) {
            throw new IllegalStateException("SHA-256 is unavailable", error);
        }
    }

    private static float[] embedding(List<Float> values) {
        if (values == null) return null;
        float[] result = new float[values.size()];
        for (int index = 0; index < values.size(); index++) result[index] = values.get(index);
        return result;
    }

    private DocumentResponse response(DocumentEntity document, List<DocumentChunkEntity> chunks) {
        return new DocumentResponse(
                document.id(),
                document.workspaceId(),
                KnowledgeSourceType.valueOf(document.sourceType()),
                document.title(),
                document.sourceUri(),
                document.sourceVersion(),
                document.jurisdiction(),
                document.effectiveFrom(),
                document.effectiveUntil(),
                document.contentSha256(),
                document.status(),
                chunks.stream()
                        .map(
                                chunk ->
                                        new DocumentChunkResponse(
                                                chunk.id(),
                                                chunk.chunkIndex(),
                                                chunk.content(),
                                                chunk.embeddingModel(),
                                                chunk.startOffset(),
                                                chunk.endOffset()))
                        .toList(),
                document.createdBy(),
                document.createdAt(),
                document.version(),
                document.origin(),
                document.memoryType(),
                document.confirmationStatus(),
                document.retrievalEligible(),
                document.projectId(),
                document.sourceRunId(),
                List.of(document.sourceMessageIds()),
                List.of(document.parentDocumentIds()),
                document.supersedes(),
                document.revisionNumber(),
                document.confirmedBy(),
                document.confirmedAt(),
                chunks.isEmpty()
                        ? List.of()
                        : projectMemory.resolve(
                                document.workspaceId(),
                                document.projectId(),
                                List.of(document.sourceMessageIds())));
    }

    private static String trim(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    private static boolean causedBy(Throwable error, String constraintName) {
        for (Throwable cause = error; cause != null; cause = cause.getCause()) {
            if (cause.getMessage() != null && cause.getMessage().contains(constraintName))
                return true;
        }
        return false;
    }
}
