package com.freelanceops.backend.domain.knowledge.entity;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "raptor_active_snapshot", schema = "app")
public class RaptorActiveSnapshotEntity {
    @Id @Column(name = "workspace_id") private UUID workspaceId;
    @Column(name = "snapshot_id", nullable = false) private UUID snapshotId;
    @Column(name = "published_at", nullable = false) private Instant publishedAt;
    @Version private long version;

    protected RaptorActiveSnapshotEntity() {
    }

    public RaptorActiveSnapshotEntity(UUID workspaceId, UUID snapshotId, Instant publishedAt) { this.workspaceId = workspaceId; this.snapshotId = snapshotId; this.publishedAt = publishedAt; }
    public void replace(UUID snapshotId, Instant publishedAt) { this.snapshotId = snapshotId; this.publishedAt = publishedAt; }
    public UUID snapshotId() { return snapshotId; }
}
