package com.freelanceops.backend.domain.specification.entity;

import com.freelanceops.backend.domain.memory.dto.response.MemorySourceMessage;
import com.freelanceops.backend.domain.specification.model.ConfirmedAnalysisSource;
import jakarta.persistence.*;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Content and provenance are immutable; only the explicit confirmation transition mutates a row. */
@Entity
@Table(name = "specification", schema = "app")
public class SpecificationEntity {
    @Id private UUID id;
    @Column(name = "workspace_id", nullable = false) private UUID workspaceId;
    @Column(name = "project_id", nullable = false) private UUID projectId;
    @Column(name = "revision_number", nullable = false) private int revisionNumber;
    private UUID supersedes;
    @Column(nullable = false, length = 20) private String status = "DRAFT";
    @Column(nullable = false, length = 300) private String title;
    @Column(name = "body_text", nullable = false, length = 100000) private String bodyText;
    @Column(name = "content_hash", nullable = false, length = 64) private String contentHash;
    @Column(name = "source_decision_id", nullable = false) private UUID sourceDecisionId;
    @Column(name = "source_decision_version", nullable = false) private int sourceDecisionVersion;
    @Column(name = "source_decision_hash", nullable = false, length = 64) private String sourceDecisionHash;
    @Column(name = "source_body_text", nullable = false, length = 100000) private String sourceBodyText;
    @Column(name = "source_run_id", nullable = false) private UUID sourceRunId;
    @Column(name = "source_project_version", nullable = false) private long sourceProjectVersion;
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "source_provenance", nullable = false, columnDefinition = "jsonb") private Map<String, Object> sourceProvenance;
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "original_sources", nullable = false, columnDefinition = "jsonb") private List<MemorySourceMessage> originalSources;
    @Column(name = "created_by", nullable = false) private UUID createdBy;
    @Column(name = "created_at", nullable = false) private Instant createdAt;
    @Column(name = "confirmed_by") private UUID confirmedBy;
    @Column(name = "confirmed_at") private Instant confirmedAt;
    @Column(name = "reusable_document_id") private UUID reusableDocumentId;
    @Version private long version;

    protected SpecificationEntity() {}

    public SpecificationEntity(UUID id, UUID workspaceId, UUID projectId, int revisionNumber,
                               UUID supersedes, String title, String bodyText, String contentHash,
                               ConfirmedAnalysisSource source, List<MemorySourceMessage> originalSources,
                               UUID createdBy, Instant createdAt) {
        this.id = id; this.workspaceId = workspaceId; this.projectId = projectId;
        this.revisionNumber = revisionNumber; this.supersedes = supersedes;
        this.title = title; this.bodyText = bodyText; this.contentHash = contentHash;
        this.sourceDecisionId = source.decisionId(); this.sourceDecisionVersion = source.decisionVersion();
        this.sourceDecisionHash = source.contentHash(); this.sourceBodyText = source.bodyText();
        this.sourceRunId = source.runId(); this.sourceProjectVersion = source.projectVersion();
        this.sourceProvenance = source.provenance(); this.originalSources = List.copyOf(originalSources);
        this.createdBy = createdBy; this.createdAt = createdAt;
    }

    public void confirm(UUID actor, UUID documentId, Instant now) {
        if (!"DRAFT".equals(status)) throw new IllegalStateException("only a draft may be confirmed");
        status = "CONFIRMED"; confirmedBy = actor; confirmedAt = now; reusableDocumentId = documentId;
    }

    public ConfirmedAnalysisSource source() {
        return new ConfirmedAnalysisSource(sourceDecisionId, sourceDecisionVersion, sourceBodyText,
            sourceDecisionHash, sourceRunId, sourceProjectVersion, List.of(), sourceProvenance, null, null);
    }
    public UUID id() { return id; }
    public UUID workspaceId() { return workspaceId; }
    public UUID projectId() { return projectId; }
    public int revisionNumber() { return revisionNumber; }
    public UUID supersedes() { return supersedes; }
    public String status() { return status; }
    public String title() { return title; }
    public String bodyText() { return bodyText; }
    public String contentHash() { return contentHash; }
    public UUID sourceDecisionId() { return sourceDecisionId; }
    public int sourceDecisionVersion() { return sourceDecisionVersion; }
    public String sourceDecisionHash() { return sourceDecisionHash; }
    public String sourceBodyText() { return sourceBodyText; }
    public UUID sourceRunId() { return sourceRunId; }
    public long sourceProjectVersion() { return sourceProjectVersion; }
    public Map<String, Object> sourceProvenance() { return sourceProvenance; }
    public List<MemorySourceMessage> originalSources() { return originalSources; }
    public UUID createdBy() { return createdBy; }
    public Instant createdAt() { return createdAt; }
    public UUID confirmedBy() { return confirmedBy; }
    public Instant confirmedAt() { return confirmedAt; }
    public UUID reusableDocumentId() { return reusableDocumentId; }
}
