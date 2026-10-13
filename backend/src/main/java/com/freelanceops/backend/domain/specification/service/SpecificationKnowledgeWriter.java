package com.freelanceops.backend.domain.specification.service;

import com.freelanceops.backend.domain.knowledge.entity.DocumentChunkEntity;
import com.freelanceops.backend.domain.knowledge.entity.DocumentEntity;
import com.freelanceops.backend.domain.knowledge.repository.DocumentChunkRepository;
import com.freelanceops.backend.domain.knowledge.repository.DocumentRepository;
import com.freelanceops.backend.domain.knowledge.service.RaptorIndexTransactions;
import com.freelanceops.backend.domain.specification.entity.SpecificationEntity;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import java.time.Instant;
import java.util.UUID;

/** Stores only the explicitly confirmed version as user-authoritative keyword memory. */
@Service
public class SpecificationKnowledgeWriter {
    private final DocumentRepository documents;
    private final DocumentChunkRepository chunks;
    private final RaptorIndexTransactions indexes;

    public SpecificationKnowledgeWriter(DocumentRepository documents, DocumentChunkRepository chunks, RaptorIndexTransactions indexes) {
        this.documents = documents; this.chunks = chunks; this.indexes = indexes;
    }

    @Transactional(readOnly = true)
    public String indexStatus(UUID workspaceId, UUID documentId) {
        return documents.findByIdAndWorkspaceId(documentId, workspaceId).map(document ->
            document.eligible(java.time.LocalDate.now()) ? "KEYWORD_ONLY"
                : "superseded".equals(document.confirmationStatus()) ? "SUPERSEDED" : "NOT_INDEXED")
            .orElse("NOT_INDEXED");
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void lockWorkspace(UUID workspaceId) { indexes.lockWorkspace(workspaceId); }

    @Transactional(propagation = Propagation.MANDATORY)
    public UUID store(UUID actor, SpecificationEntity specification, Instant now) {
        var existing = documents.findBySourceSpecificationId(specification.id());
        if (existing.isPresent()) return existing.get().id();
        indexes.invalidateActiveSnapshot(specification.workspaceId());
        var previous = documents.findAllByWorkspaceIdAndProjectIdAndOrigin(specification.workspaceId(), specification.projectId(), "user")
            .stream().filter(document -> document.sourceSpecificationId() != null && document.retrievalEligible())
            .toList();
        previous.forEach(document -> document.supersede(now));
        UUID documentId = UUID.randomUUID();
        DocumentEntity document = new DocumentEntity(documentId, specification.workspaceId(), "PAST_PROJECT",
            specification.title(), "specification:" + specification.id(), "spec-v" + specification.revisionNumber(),
            null, null, null, specification.contentHash(), actor, now);
        document.confirm(actor, now, previous.stream().max(java.util.Comparator.comparingInt(DocumentEntity::revisionNumber)).orElse(null));
        document.specification(specification.projectId(), specification.id(),
            specification.originalSources().stream().map(source -> source.id()).toArray(UUID[]::new), specification.revisionNumber());
        documents.saveAndFlush(document);
        chunks.saveAll(SpecificationText.chunks(specification.bodyText()).stream().map(chunk ->
            new DocumentChunkEntity(UUID.randomUUID(), specification.workspaceId(), documentId, chunk.index(),
                chunk.content(), null, null, chunk.startOffset(), chunk.endOffset(), now)).toList());
        chunks.flush();
        return documentId;
    }
}
