ALTER TABLE app.document_chunk
    ADD CONSTRAINT uq_document_chunk_workspace_id UNIQUE (workspace_id, id);

CREATE TABLE app.raptor_index_snapshot (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES app.workspace(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL CHECK (status IN ('BUILDING', 'PUBLISHED', 'SUPERSEDED', 'FAILED')),
    embedding_model VARCHAR(120) NOT NULL,
    summary_model VARCHAR(120) NOT NULL,
    source_fingerprint VARCHAR(64) NOT NULL,
    created_by UUID NOT NULL REFERENCES app.user_account(id),
    created_at TIMESTAMPTZ NOT NULL,
    published_at TIMESTAMPTZ,
    failed_at TIMESTAMPTZ,
    failure_code VARCHAR(80),
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT uq_raptor_snapshot_scope UNIQUE (workspace_id, id),
    CONSTRAINT ck_raptor_snapshot_terminal_fields CHECK (
        (status = 'PUBLISHED' AND published_at IS NOT NULL AND failed_at IS NULL AND failure_code IS NULL)
        OR (status = 'SUPERSEDED' AND published_at IS NOT NULL AND failed_at IS NULL AND failure_code IS NULL)
        OR (status = 'FAILED' AND published_at IS NULL AND failed_at IS NOT NULL AND failure_code IS NOT NULL)
        OR (status = 'BUILDING' AND published_at IS NULL AND failed_at IS NULL AND failure_code IS NULL)
    )
);

CREATE TABLE app.raptor_node (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL,
    snapshot_id UUID NOT NULL,
    kind VARCHAR(20) NOT NULL CHECK (kind IN ('LEAF', 'SUMMARY')),
    level INTEGER NOT NULL CHECK (level >= 0),
    content VARCHAR(20000) NOT NULL,
    embedding VECTOR(1536) NOT NULL,
    child_ids UUID[] NOT NULL DEFAULT '{}',
    source_chunk_id UUID,
    document_id UUID,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT uq_raptor_node_scope UNIQUE (workspace_id, snapshot_id, id),
    CONSTRAINT fk_raptor_node_snapshot FOREIGN KEY (workspace_id, snapshot_id)
        REFERENCES app.raptor_index_snapshot(workspace_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_raptor_node_source_chunk FOREIGN KEY (workspace_id, source_chunk_id)
        REFERENCES app.document_chunk(workspace_id, id),
    CONSTRAINT fk_raptor_node_document FOREIGN KEY (workspace_id, document_id)
        REFERENCES app.document(workspace_id, id),
    CONSTRAINT ck_raptor_node_shape CHECK (
        (kind = 'LEAF' AND level = 0 AND source_chunk_id IS NOT NULL AND document_id IS NOT NULL AND cardinality(child_ids) = 0)
        OR (kind = 'SUMMARY' AND level > 0 AND source_chunk_id IS NULL AND document_id IS NULL AND cardinality(child_ids) > 0)
    )
);

CREATE TABLE app.raptor_active_snapshot (
    workspace_id UUID PRIMARY KEY REFERENCES app.workspace(id) ON DELETE CASCADE,
    snapshot_id UUID NOT NULL,
    published_at TIMESTAMPTZ NOT NULL,
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT fk_raptor_active_snapshot FOREIGN KEY (workspace_id, snapshot_id)
        REFERENCES app.raptor_index_snapshot(workspace_id, id)
);

CREATE INDEX ix_raptor_snapshot_workspace_status ON app.raptor_index_snapshot(workspace_id, status, created_at DESC);
CREATE INDEX ix_raptor_node_snapshot_level ON app.raptor_node(workspace_id, snapshot_id, level);
CREATE INDEX ix_raptor_node_embedding ON app.raptor_node USING hnsw (embedding vector_cosine_ops);
