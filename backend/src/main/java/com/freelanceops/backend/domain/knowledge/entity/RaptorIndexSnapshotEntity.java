package com.freelanceops.backend.domain.knowledge.entity;

import com.freelanceops.backend.domain.knowledge.model.RaptorSnapshotStatus;
import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "raptor_index_snapshot", schema = "app")
public class RaptorIndexSnapshotEntity {
    @Id private UUID id;
    @Column(name = "workspace_id", nullable = false) private UUID workspaceId;
    @Enumerated(EnumType.STRING) @Column(nullable = false, length = 20) private RaptorSnapshotStatus status;
    @Column(name = "embedding_model", nullable = false, length = 120) private String embeddingModel;
    @Column(name = "summary_model", nullable = false, length = 120) private String summaryModel;
    @Column(name = "source_fingerprint", nullable = false, length = 64) private String sourceFingerprint;
    @Column(name = "created_by", nullable = false) private UUID createdBy;
    @Column(name = "created_at", nullable = false) private Instant createdAt;
    @Column(name = "published_at") private Instant publishedAt;
    @Column(name = "failed_at") private Instant failedAt;
    @Column(name = "failure_code", length = 80) private String failureCode;
    @Version private long version;

    protected RaptorIndexSnapshotEntity() {
    }

    public RaptorIndexSnapshotEntity(UUID id, UUID workspaceId, String embeddingModel, String summaryModel, String sourceFingerprint, UUID createdBy, Instant createdAt) {
        this.id = id; this.workspaceId = workspaceId; this.status = RaptorSnapshotStatus.BUILDING;
        this.embeddingModel = embeddingModel; this.summaryModel = summaryModel; this.sourceFingerprint = sourceFingerprint;
        this.createdBy = createdBy; this.createdAt = createdAt;
    }

    public void publish(Instant now) { requireBuilding(); status = RaptorSnapshotStatus.PUBLISHED; publishedAt = now; }
    public void supersede() { if (status != RaptorSnapshotStatus.PUBLISHED) throw new IllegalStateException("only published snapshots can be superseded"); status = RaptorSnapshotStatus.SUPERSEDED; }
    public void fail(String code, Instant now) { requireBuilding(); status = RaptorSnapshotStatus.FAILED; failureCode = code; failedAt = now; }
    private void requireBuilding() { if (status != RaptorSnapshotStatus.BUILDING) throw new IllegalStateException("RAPTOR snapshot is not building"); }
    public UUID id() { return id; }
    public UUID workspaceId() { return workspaceId; }
    public RaptorSnapshotStatus status() { return status; }
    public String embeddingModel() { return embeddingModel; }
    public String summaryModel() { return summaryModel; }
    public String sourceFingerprint() { return sourceFingerprint; }
    public Instant createdAt() { return createdAt; }
}
