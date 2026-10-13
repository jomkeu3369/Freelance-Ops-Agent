-- Draft content is immutable. Every edit creates a new project-scoped revision.
CREATE TABLE app.specification (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL,
    project_id UUID NOT NULL,
    revision_number INTEGER NOT NULL CHECK (revision_number > 0),
    supersedes UUID,
    status VARCHAR(20) NOT NULL CHECK (status IN ('DRAFT', 'CONFIRMED')),
    title VARCHAR(300) NOT NULL CHECK (length(btrim(title)) > 0),
    body_text VARCHAR(100000) NOT NULL CHECK (length(btrim(body_text)) > 0),
    content_hash VARCHAR(64) NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
    source_decision_id UUID NOT NULL,
    source_decision_version INTEGER NOT NULL CHECK (source_decision_version > 0),
    source_decision_hash VARCHAR(64) NOT NULL CHECK (source_decision_hash ~ '^[a-f0-9]{64}$'),
    source_body_text VARCHAR(100000) NOT NULL,
    source_run_id UUID NOT NULL,
    source_project_version BIGINT NOT NULL CHECK (source_project_version >= 0),
    source_provenance JSONB NOT NULL CHECK (jsonb_typeof(source_provenance) = 'object'),
    original_sources JSONB NOT NULL CHECK (jsonb_typeof(original_sources) = 'array' AND jsonb_array_length(original_sources) > 0),
    created_by UUID NOT NULL REFERENCES app.user_account(id),
    created_at TIMESTAMPTZ NOT NULL,
    confirmed_by UUID REFERENCES app.user_account(id),
    confirmed_at TIMESTAMPTZ,
    reusable_document_id UUID,
    version BIGINT NOT NULL DEFAULT 0,
    UNIQUE (workspace_id, project_id, id),
    UNIQUE (workspace_id, project_id, revision_number),
    CONSTRAINT fk_specification_project FOREIGN KEY (workspace_id, project_id)
        REFERENCES app.project(workspace_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_specification_decision FOREIGN KEY (workspace_id, project_id, source_decision_id)
        REFERENCES app.analysis_decision(workspace_id, project_id, id),
    CONSTRAINT fk_specification_previous FOREIGN KEY (workspace_id, project_id, supersedes)
        REFERENCES app.specification(workspace_id, project_id, id) DEFERRABLE INITIALLY DEFERRED,
    CONSTRAINT ck_specification_confirmation CHECK (
        (status = 'DRAFT' AND confirmed_by IS NULL AND confirmed_at IS NULL AND reusable_document_id IS NULL)
        OR (status = 'CONFIRMED' AND confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL AND reusable_document_id IS NOT NULL)
    ),
    CONSTRAINT ck_specification_provenance_size CHECK (octet_length(source_provenance::text) <= 1500000 AND octet_length(original_sources::text) <= 1500000)
);
CREATE INDEX ix_specification_project_revision ON app.specification(workspace_id, project_id, revision_number DESC);

CREATE TABLE app.specification_request (
    workspace_id UUID NOT NULL,
    project_id UUID NOT NULL,
    request_id UUID NOT NULL,
    operation_hash VARCHAR(64) NOT NULL CHECK (operation_hash ~ '^[a-f0-9]{64}$'),
    specification_id UUID NOT NULL,
    PRIMARY KEY (workspace_id, project_id, request_id),
    CONSTRAINT fk_specification_request FOREIGN KEY (workspace_id, project_id, specification_id)
        REFERENCES app.specification(workspace_id, project_id, id) ON DELETE CASCADE
);

-- References with identical text may belong to different immutable specification revisions.
ALTER TABLE app.document ADD COLUMN source_specification_id UUID;
ALTER TABLE app.document ADD CONSTRAINT fk_document_specification_scope
    FOREIGN KEY (workspace_id, project_id, source_specification_id)
    REFERENCES app.specification(workspace_id, project_id, id) ON DELETE CASCADE;
CREATE UNIQUE INDEX uq_document_source_specification ON app.document(source_specification_id) WHERE source_specification_id IS NOT NULL;
DROP INDEX app.uq_document_workspace_hash;
CREATE UNIQUE INDEX uq_document_workspace_hash ON app.document(workspace_id, content_sha256)
    WHERE source_run_id IS NULL AND source_specification_id IS NULL;
ALTER TABLE app.specification ADD CONSTRAINT fk_specification_reusable_document
    FOREIGN KEY (workspace_id, reusable_document_id) REFERENCES app.document(workspace_id, id)
    DEFERRABLE INITIALLY DEFERRED;

CREATE FUNCTION app.enforce_specification_immutability() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF NOT EXISTS (SELECT 1 FROM app.project WHERE id = OLD.project_id) THEN RETURN OLD; END IF;
        RAISE EXCEPTION 'specification revisions are immutable; delete the project aggregate instead';
    END IF;
    IF OLD.status <> 'DRAFT' OR NEW.status <> 'CONFIRMED'
       OR NEW.version <> OLD.version + 1
       OR (to_jsonb(NEW) - ARRAY['status','confirmed_by','confirmed_at','reusable_document_id','version'])
          IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','confirmed_by','confirmed_at','reusable_document_id','version']) THEN
        RAISE EXCEPTION 'specification content is immutable; append a revision';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM app.document document
        WHERE document.workspace_id = NEW.workspace_id AND document.project_id = NEW.project_id
          AND document.id = NEW.reusable_document_id AND document.source_specification_id = NEW.id
          AND document.origin = 'user' AND document.memory_type = 'decision'
          AND document.confirmation_status = 'confirmed' AND document.retrieval_eligible
          AND document.content_sha256 = NEW.content_hash AND document.confirmed_by = NEW.confirmed_by
          AND (SELECT string_agg(chunk.content, '' ORDER BY chunk.chunk_index) FROM app.document_chunk chunk
               WHERE chunk.workspace_id = NEW.workspace_id AND chunk.document_id = document.id) = NEW.body_text
    ) THEN RAISE EXCEPTION 'specification confirmation requires an exact lossless keyword document'; END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER specification_immutable BEFORE UPDATE OR DELETE ON app.specification
    FOR EACH ROW EXECUTE FUNCTION app.enforce_specification_immutability();

-- A DB writer cannot pass a draft result or invent a different confirmed source.
CREATE FUNCTION app.enforce_specification_source() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.status <> 'DRAFT' THEN
        RAISE EXCEPTION 'specification must begin as a draft and use the lossless confirmation transition';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM app.analysis_decision source
        WHERE source.workspace_id = NEW.workspace_id AND source.project_id = NEW.project_id AND source.id = NEW.source_decision_id
          AND source.status = 'CONFIRMED' AND source.version_number = NEW.source_decision_version
          AND source.content_hash = NEW.source_decision_hash AND source.body_text = NEW.source_body_text
          AND source.source_run_id = NEW.source_run_id AND source.source_project_version = NEW.source_project_version
    ) THEN RAISE EXCEPTION 'specification requires the exact confirmed result source'; END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER specification_confirmed_source BEFORE INSERT ON app.specification
    FOR EACH ROW EXECUTE FUNCTION app.enforce_specification_source();

-- A changed original remains preserved, but prior specification memory must not
-- continue to be presented as current truth for that project.
CREATE OR REPLACE FUNCTION app.invalidate_derived_memory() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.kind IN ('PROJECT_INPUT', 'USER_CLARIFICATION', 'REQUIREMENT_CONFIRMATION') THEN
        PERFORM 1 FROM app.workspace WHERE id = NEW.workspace_id FOR UPDATE;
        UPDATE app.document SET confirmation_status = 'superseded', retrieval_eligible = FALSE, updated_at = now(), version = version + 1
        WHERE workspace_id = NEW.workspace_id AND project_id = NEW.project_id
          AND (origin = 'agent' OR source_specification_id IS NOT NULL) AND confirmation_status <> 'superseded';
        UPDATE app.raptor_index_snapshot SET status = 'SUPERSEDED'
        WHERE id IN (SELECT snapshot_id FROM app.raptor_active_snapshot WHERE workspace_id = NEW.workspace_id);
        DELETE FROM app.raptor_active_snapshot WHERE workspace_id = NEW.workspace_id;
    END IF;
    RETURN NEW;
END;
$$;

CREATE FUNCTION app.invalidate_specification_memory_on_result_confirmation() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    PERFORM 1 FROM app.workspace WHERE id = NEW.workspace_id FOR UPDATE;
    UPDATE app.document SET confirmation_status = 'superseded', retrieval_eligible = FALSE,
        updated_at = now(), version = version + 1
    WHERE workspace_id = NEW.workspace_id AND project_id = NEW.project_id
      AND source_specification_id IS NOT NULL AND confirmation_status <> 'superseded';
    UPDATE app.raptor_index_snapshot SET status = 'SUPERSEDED'
    WHERE id IN (SELECT snapshot_id FROM app.raptor_active_snapshot WHERE workspace_id = NEW.workspace_id);
    DELETE FROM app.raptor_active_snapshot WHERE workspace_id = NEW.workspace_id;
    RETURN NEW;
END;
$$;
CREATE TRIGGER analysis_confirmation_invalidates_specification_memory AFTER UPDATE OF status ON app.analysis_decision
    FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'CONFIRMED')
    EXECUTE FUNCTION app.invalidate_specification_memory_on_result_confirmation();
