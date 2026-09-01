package com.freelanceops.backend.domain.knowledge.entity;

import com.freelanceops.backend.domain.knowledge.model.RaptorNodeKind;
import jakarta.persistence.*;
import org.hibernate.annotations.Array;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;

@Entity
@Table(name = "raptor_node", schema = "app")
public class RaptorNodeEntity {
    @Id private UUID id;
    @Column(name = "workspace_id", nullable = false) private UUID workspaceId;
    @Column(name = "snapshot_id", nullable = false) private UUID snapshotId;
    @Enumerated(EnumType.STRING) @Column(nullable = false, length = 20) private RaptorNodeKind kind;
    @Column(nullable = false) private int level;
    @Column(nullable = false, length = 20000) private String content;
    @JdbcTypeCode(SqlTypes.VECTOR) @Array(length = 1536) @Column(nullable = false, columnDefinition = "vector(1536)") private float[] embedding;
    @JdbcTypeCode(SqlTypes.ARRAY) @Column(name = "child_ids", nullable = false, columnDefinition = "uuid[]") private UUID[] childIds;
    @Column(name = "source_chunk_id") private UUID sourceChunkId;
    @Column(name = "document_id") private UUID documentId;
    @JdbcTypeCode(SqlTypes.JSON) @Column(nullable = false, columnDefinition = "jsonb") private Map<String, String> metadata;
    @Column(name = "created_at", nullable = false) private Instant createdAt;

    protected RaptorNodeEntity() {
    }

    public RaptorNodeEntity(UUID id, UUID workspaceId, UUID snapshotId, RaptorNodeKind kind, int level, String content, float[] embedding, UUID[] childIds, UUID sourceChunkId, UUID documentId, Map<String, String> metadata, Instant createdAt) {
        this.id = id; this.workspaceId = workspaceId; this.snapshotId = snapshotId; this.kind = kind; this.level = level;
        this.content = content; this.embedding = embedding; this.childIds = childIds.clone(); this.sourceChunkId = sourceChunkId;
        this.documentId = documentId; this.metadata = Map.copyOf(metadata); this.createdAt = createdAt;
    }

    public UUID id() { return id; }
    public UUID snapshotId() { return snapshotId; }
    public RaptorNodeKind kind() { return kind; }
    public int level() { return level; }
    public String content() { return content; }
    public float[] embedding() { return embedding; }
    public UUID[] childIds() { return childIds.clone(); }
    public UUID sourceChunkId() { return sourceChunkId; }
}
