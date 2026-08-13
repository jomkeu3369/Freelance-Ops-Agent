package com.freelanceops.backend.domain.knowledge.entity;

import jakarta.persistence.*;
import org.hibernate.annotations.Array;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "document_chunk", schema = "app")
public class DocumentChunkEntity {
    @Id private UUID id;
    @Column(name = "workspace_id", nullable = false) private UUID workspaceId;
    @Column(name = "document_id", nullable = false) private UUID documentId;
    @Column(name = "chunk_index", nullable = false) private int chunkIndex;
    @Column(nullable = false, length = 20000) private String content;
    @JdbcTypeCode(SqlTypes.VECTOR)
    @Array(length = 1536)
    @Column(columnDefinition = "vector(1536)")
    private float[] embedding;
    @Column(name = "embedding_model", length = 120) private String embeddingModel;
    @Column(name = "embedding_dimension") private Integer embeddingDimension;
    @Column(name = "start_offset") private Integer startOffset;
    @Column(name = "end_offset") private Integer endOffset;
    @Column(name = "created_at", nullable = false) private Instant createdAt;

    protected DocumentChunkEntity() {
    }

    public DocumentChunkEntity(UUID id, UUID workspaceId, UUID documentId, int chunkIndex, String content, float[] embedding, String embeddingModel, Integer startOffset, Integer endOffset, Instant createdAt) {
        if (embedding != null && embedding.length != 1536) throw new IllegalArgumentException("embedding dimension must be 1536");
        if ((embedding == null) != (embeddingModel == null)) throw new IllegalArgumentException("embedding and model must be supplied together");
        this.id = id; this.workspaceId = workspaceId; this.documentId = documentId; this.chunkIndex = chunkIndex;
        this.content = content; this.embedding = embedding; this.embeddingModel = embeddingModel;
        this.embeddingDimension = embedding == null ? null : embedding.length;
        this.startOffset = startOffset; this.endOffset = endOffset; this.createdAt = createdAt;
    }

    public UUID id() { return id; }
    public UUID workspaceId() { return workspaceId; }
    public UUID documentId() { return documentId; }
    public int chunkIndex() { return chunkIndex; }
    public String content() { return content; }
    public float[] embedding() { return embedding; }
    public String embeddingModel() { return embeddingModel; }
    public Integer startOffset() { return startOffset; }
    public Integer endOffset() { return endOffset; }
}
