package com.freelanceops.backend.domain.knowledge.entity;
import jakarta.persistence.*;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

@Entity
@Table(name = "document", schema = "app")
public class DocumentEntity {
    @Id private UUID id;
    @Column(name = "workspace_id", nullable = false) private UUID workspaceId;
    @Column(name = "source_type", nullable = false, length = 30) private String sourceType;
    @Column(nullable = false, length = 300) private String title;
    @Column(name = "source_uri", length = 2000) private String sourceUri;
    @Column(name = "source_version", length = 120) private String sourceVersion;
    @Column(length = 120) private String jurisdiction;
    @Column(name = "effective_from") private LocalDate effectiveFrom;
    @Column(name = "effective_until") private LocalDate effectiveUntil;
    @Column(name = "content_sha256", nullable = false, length = 64) private String contentSha256;
    @Column(nullable = false, length = 20) private String status;
    @Column(name = "created_by", nullable = false) private UUID createdBy;
    @Column(name = "created_at", nullable = false) private Instant createdAt;
    @Column(name = "updated_at", nullable = false) private Instant updatedAt;
    @Version private long version;
    @Column(nullable = false) private String origin = "external";
    @Column(name = "memory_type", nullable = false) private String memoryType = "reference";
    @Column(name = "confirmation_status", nullable = false) private String confirmationStatus = "unconfirmed";
    @Column(name = "retrieval_eligible", nullable = false) private boolean retrievalEligible;
    @Column(name = "project_id") private UUID projectId;
    @Column(name = "source_run_id") private UUID sourceRunId;
    @Column(name = "source_message_ids", nullable = false) private UUID[] sourceMessageIds = new UUID[0];
    @Column(name = "parent_document_ids", nullable = false) private UUID[] parentDocumentIds = new UUID[0];
    private UUID supersedes;
    @Column(name = "revision_number", nullable = false) private int revisionNumber = 1;
    @Column(name = "source_event_order") private Long sourceEventOrder;
    @Column(name = "confirmed_by") private UUID confirmedBy;
    @Column(name = "confirmed_at") private Instant confirmedAt;

    protected DocumentEntity() {
    }

    public DocumentEntity(UUID id, UUID workspaceId, String sourceType, String title, String sourceUri, String sourceVersion, String jurisdiction, LocalDate effectiveFrom, LocalDate effectiveUntil, String contentSha256, UUID createdBy, Instant now) {
        this.id = id; this.workspaceId = workspaceId; this.sourceType = sourceType; this.title = title;
        this.sourceUri = sourceUri; this.sourceVersion = sourceVersion; this.jurisdiction = jurisdiction;
        this.effectiveFrom = effectiveFrom; this.effectiveUntil = effectiveUntil; this.contentSha256 = contentSha256;
        this.status = "ACTIVE"; this.createdBy = createdBy; this.createdAt = now; this.updatedAt = now;
    }

    public void archive(Instant now) { status = "ARCHIVED"; retrievalEligible = false; updatedAt = now; }
    public void generated(UUID projectId, UUID runId, UUID[] sources, long sourceOrder) {
        if (sources.length == 0) throw new IllegalArgumentException("generated memory requires original sources");
        this.origin = "agent"; this.memoryType = "summary"; this.projectId = projectId;
        this.sourceRunId = runId; this.sourceMessageIds = sources.clone(); this.sourceEventOrder = sourceOrder;
    }
    public void parents(UUID[] ids) { this.parentDocumentIds = ids.clone(); }
    public void confirm(UUID actor, Instant now, DocumentEntity previous) {
        if (!"ACTIVE".equals(status) || "superseded".equals(confirmationStatus) || "assumption".equals(memoryType) || "response".equals(memoryType)) throw new IllegalStateException("document is not confirmable");
        if (previous != null) {
            this.supersedes = previous.id(); this.revisionNumber = previous.revisionNumber() + 1;
        }
        this.confirmationStatus = "confirmed"; this.retrievalEligible = true;
        this.confirmedBy = actor; this.confirmedAt = now; this.updatedAt = now;
    }
    public void supersede(Instant now) { confirmationStatus = "superseded"; retrievalEligible = false; updatedAt = now; }
    public boolean eligible(java.time.LocalDate today) {
        return "ACTIVE".equals(status) && retrievalEligible && "confirmed".equals(confirmationStatus)
            && !"assumption".equals(memoryType) && !"response".equals(memoryType)
            && (effectiveFrom == null || !effectiveFrom.isAfter(today)) && (effectiveUntil == null || !effectiveUntil.isBefore(today));
    }
    public String origin() { return origin; }
    public String memoryType() { return memoryType; }
    public String confirmationStatus() { return confirmationStatus; }
    public boolean retrievalEligible() { return retrievalEligible; }
    public UUID projectId() { return projectId; }
    public UUID sourceRunId() { return sourceRunId; }
    public UUID[] sourceMessageIds() { return sourceMessageIds.clone(); }
    public UUID[] parentDocumentIds() { return parentDocumentIds.clone(); }
    public UUID supersedes() { return supersedes; }
    public int revisionNumber() { return revisionNumber; }
    public Long sourceEventOrder() { return sourceEventOrder; }
    public UUID confirmedBy() { return confirmedBy; }
    public Instant confirmedAt() { return confirmedAt; }
    public UUID id() { return id; }
    public UUID workspaceId() { return workspaceId; }
    public String sourceType() { return sourceType; }
    public String title() { return title; }
    public String sourceUri() { return sourceUri; }
    public String sourceVersion() { return sourceVersion; }
    public String jurisdiction() { return jurisdiction; }
    public LocalDate effectiveFrom() { return effectiveFrom; }
    public LocalDate effectiveUntil() { return effectiveUntil; }
    public String contentSha256() { return contentSha256; }
    public String status() { return status; }
    public UUID createdBy() { return createdBy; }
    public Instant createdAt() { return createdAt; }
    public long version() { return version; }
}
