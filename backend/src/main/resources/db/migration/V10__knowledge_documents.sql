CREATE TABLE app.document (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES app.workspace(id) ON DELETE CASCADE,
    source_type VARCHAR(30) NOT NULL CHECK (source_type IN ('PAST_PROJECT', 'POLICY', 'PLATFORM_TERMS', 'USER_TEMPLATE', 'EXTERNAL_SOURCE')),
    title VARCHAR(300) NOT NULL,
    source_uri VARCHAR(2000),
    source_version VARCHAR(120),
    jurisdiction VARCHAR(120),
    effective_from DATE,
    effective_until DATE,
    content_sha256 VARCHAR(64) NOT NULL,
    status VARCHAR(20) NOT NULL CHECK (status IN ('ACTIVE', 'ARCHIVED')),
    created_by UUID NOT NULL REFERENCES app.user_account(id),
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT uq_document_workspace_id UNIQUE (workspace_id, id),
    CONSTRAINT uq_document_workspace_hash UNIQUE (workspace_id, content_sha256)
);

CREATE TABLE app.document_chunk (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL,
    document_id UUID NOT NULL,
    chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
    content VARCHAR(20000) NOT NULL,
    search_vector TSVECTOR GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED,
    embedding VECTOR(1536),
    embedding_model VARCHAR(120),
    embedding_dimension INTEGER,
    start_offset INTEGER,
    end_offset INTEGER,
    created_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT fk_document_chunk_scope FOREIGN KEY (workspace_id, document_id)
        REFERENCES app.document(workspace_id, id) ON DELETE CASCADE,
    CONSTRAINT uq_document_chunk_index UNIQUE (document_id, chunk_index),
    CONSTRAINT ck_document_embedding_metadata CHECK (
        (embedding IS NULL AND embedding_model IS NULL AND embedding_dimension IS NULL)
        OR (embedding IS NOT NULL AND embedding_model IS NOT NULL AND embedding_dimension = 1536)
    )
);

CREATE INDEX ix_document_workspace_status ON app.document(workspace_id, status, updated_at DESC);
CREATE INDEX ix_document_chunk_search ON app.document_chunk USING GIN(search_vector);
CREATE INDEX ix_document_chunk_workspace ON app.document_chunk(workspace_id, document_id, chunk_index);
CREATE INDEX ix_document_chunk_embedding ON app.document_chunk USING hnsw (embedding vector_cosine_ops)
    WHERE embedding IS NOT NULL;
