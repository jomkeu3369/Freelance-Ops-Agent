package com.freelanceops.backend.domain.knowledge.service;
import com.freelanceops.backend.domain.workspace.repository.WorkspaceRepository;
import com.freelanceops.backend.domain.memory.dto.response.MemorySourceMessage;
import com.freelanceops.backend.domain.knowledge.entity.DocumentEntity;
import com.freelanceops.backend.domain.knowledge.entity.DocumentChunkEntity;
import com.freelanceops.backend.domain.knowledge.repository.DocumentRepository;
import com.freelanceops.backend.domain.knowledge.repository.DocumentChunkRepository;
import com.freelanceops.backend.domain.memory.service.ProjectMemoryService;
import com.freelanceops.backend.global.event.RequirementAnalysisCompleted;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;

@Component
public class GeneratedMemoryListener {
    private final DocumentRepository documents;
    private final DocumentChunkRepository chunks;
    private final ProjectMemoryService memory;
    private final WorkspaceRepository workspaces;
    public GeneratedMemoryListener(DocumentRepository documents, DocumentChunkRepository chunks, ProjectMemoryService memory, WorkspaceRepository workspaces) {
        this.documents = documents; this.chunks = chunks; this.memory = memory; this.workspaces = workspaces;
    }

    @EventListener
    @Transactional(propagation = Propagation.MANDATORY)
    public void completed(RequirementAnalysisCompleted event) {
        if (event.summary() == null || event.summary().isBlank() || documents.findBySourceRunId(event.runId()).isPresent()) return;
        workspaces.findByIdForUpdate(event.workspaceId()).orElseThrow();
        var sources = memory.forRun(event.workspaceId(), event.projectId(), event.runId());
        if (sources.isEmpty()) return;
        Instant now = Instant.now();
        UUID documentId = UUID.randomUUID();
        String text = event.summary().strip();
        DocumentEntity document = new DocumentEntity(documentId, event.workspaceId(), "PAST_PROJECT", "AI 요구사항 정리", null, event.runId().toString(), null, null, null, hash(text), event.initiatedBy(), now);
        long sourceOrder = sources.stream().filter(source -> !"RUN_INPUT".equals(source.kind())).mapToLong(MemorySourceMessage::eventOrder).max().orElse(0);
        document.generated(event.projectId(), event.runId(), sources.stream().map(MemorySourceMessage::id).toArray(UUID[]::new), sourceOrder);
        document.parents(event.parentDocumentIds().stream().distinct().limit(50)
            .filter(id -> documents.findByIdAndWorkspaceId(id, event.workspaceId()).filter(parent -> parent.projectId() == null || event.projectId().equals(parent.projectId())).isPresent()).toArray(UUID[]::new));
        long currentOrder = memory.current(event.workspaceId(), event.projectId()).stream().mapToLong(MemorySourceMessage::eventOrder).max().orElse(0);
        if (currentOrder > sourceOrder) document.supersede(now);
        documents.saveAndFlush(document);
        chunks.saveAll(List.of(new DocumentChunkEntity(UUID.randomUUID(), event.workspaceId(), documentId, 0, text, null, null, 0, text.length(), now)));
    }

    private static String hash(String text) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8))); }
        catch (java.security.NoSuchAlgorithmException error) { throw new IllegalStateException(error); }
    }
}
