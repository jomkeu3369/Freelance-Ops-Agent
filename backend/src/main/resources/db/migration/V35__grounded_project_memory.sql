ALTER TABLE app.document
    ADD COLUMN origin VARCHAR(20) NOT NULL DEFAULT 'external' CHECK (origin IN ('user', 'agent', 'external')),
    ADD COLUMN memory_type VARCHAR(20) NOT NULL DEFAULT 'reference' CHECK (memory_type IN ('requirement', 'decision', 'summary', 'assumption', 'response', 'reference')),
    ADD COLUMN confirmation_status VARCHAR(20) NOT NULL DEFAULT 'unconfirmed' CHECK (confirmation_status IN ('confirmed', 'unconfirmed', 'superseded')),
    ADD COLUMN retrieval_eligible BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN project_id UUID,
    ADD COLUMN source_run_id UUID,
    ADD COLUMN source_message_ids UUID[] NOT NULL DEFAULT '{}',
    ADD COLUMN parent_document_ids UUID[] NOT NULL DEFAULT '{}',
    ADD COLUMN supersedes UUID REFERENCES app.document(id),
    ADD COLUMN revision_number INTEGER NOT NULL DEFAULT 1 CHECK (revision_number > 0),
    ADD COLUMN source_event_order BIGINT,
    ADD COLUMN confirmed_by UUID REFERENCES app.user_account(id),
    ADD COLUMN confirmed_at TIMESTAMPTZ,
    ADD CONSTRAINT fk_document_project_scope FOREIGN KEY (workspace_id, project_id) REFERENCES app.project(workspace_id, id) ON DELETE CASCADE,
    ADD CONSTRAINT ck_document_confirmation CHECK (NOT retrieval_eligible OR (confirmation_status = 'confirmed' AND confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL)),
    ADD CONSTRAINT ck_agent_document_sources CHECK (origin <> 'agent' OR (project_id IS NOT NULL AND source_run_id IS NOT NULL AND cardinality(source_message_ids) > 0));

-- Existing ACTIVE documents remain unconfirmed until explicitly reviewed.
ALTER TABLE app.document DROP CONSTRAINT uq_document_workspace_hash;
CREATE UNIQUE INDEX uq_document_workspace_hash ON app.document(workspace_id, content_sha256) WHERE source_run_id IS NULL;
CREATE UNIQUE INDEX uq_document_source_run ON app.document(source_run_id) WHERE source_run_id IS NOT NULL;
CREATE INDEX ix_document_eligible ON app.document(workspace_id, project_id) WHERE retrieval_eligible AND status = 'ACTIVE';

CREATE TABLE app.source_message (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_order BIGSERIAL NOT NULL UNIQUE,
    workspace_id UUID NOT NULL,
    project_id UUID NOT NULL,
    run_id UUID,
    event_key TEXT NOT NULL UNIQUE,
    kind VARCHAR(40) NOT NULL,
    content TEXT NOT NULL,
    prompt TEXT,
    created_by UUID REFERENCES app.user_account(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_source_project FOREIGN KEY (workspace_id, project_id) REFERENCES app.project(workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX ix_source_message_project ON app.source_message(workspace_id, project_id, event_order);
CREATE INDEX ix_source_message_run ON app.source_message(run_id, kind);
CREATE FUNCTION app.reject_source_message_update() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM app.project WHERE id = OLD.project_id) THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'source messages are immutable; append a correction';
END;
$$;
CREATE TRIGGER source_message_immutable BEFORE UPDATE OR DELETE ON app.source_message FOR EACH ROW EXECUTE FUNCTION app.reject_source_message_update();

-- Preserve current originals before future edits; explicit project deletion still cascades.
INSERT INTO app.source_message(workspace_id, project_id, event_key, kind, content, created_by)
SELECT workspace_id, id, 'project-baseline:' || id, 'PROJECT_INPUT', requirement_text, created_by FROM app.project;

ALTER TABLE app.project ADD COLUMN requirement_updated_by UUID REFERENCES app.user_account(id);
CREATE FUNCTION app.capture_project_source() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' OR NEW.requirement_text IS DISTINCT FROM OLD.requirement_text THEN
        INSERT INTO app.source_message(workspace_id, project_id, event_key, kind, content, created_by)
        VALUES (NEW.workspace_id, NEW.id, 'project:' || gen_random_uuid(), 'PROJECT_INPUT', NEW.requirement_text, CASE WHEN TG_OP = 'INSERT' THEN NEW.created_by ELSE NEW.requirement_updated_by END);
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER project_source_insert AFTER INSERT ON app.project FOR EACH ROW EXECUTE FUNCTION app.capture_project_source();
CREATE TRIGGER project_source_update AFTER UPDATE OF requirement_text ON app.project FOR EACH ROW EXECUTE FUNCTION app.capture_project_source();

CREATE FUNCTION app.capture_run_source() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE run_row app.agent_run%ROWTYPE;
BEGIN
    IF NEW.command_type = 'START' THEN
        SELECT * INTO STRICT run_row FROM app.agent_run WHERE id = NEW.run_id;
        INSERT INTO app.source_message(workspace_id, project_id, run_id, event_key, kind, content, created_by)
        VALUES (run_row.workspace_id, run_row.project_id, NEW.run_id, 'run:' || NEW.run_id, 'RUN_INPUT',
                NEW.payload::jsonb #>> '{input,requirementText}', NEW.requested_by)
        ON CONFLICT (event_key) DO NOTHING;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER agent_run_source AFTER INSERT ON app.agent_run_command FOR EACH ROW EXECUTE FUNCTION app.capture_run_source();

CREATE FUNCTION app.capture_clarification_source() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE run_row app.agent_run%ROWTYPE; answer JSONB;
BEGIN
    IF NEW.status = 'RESPONDED' AND OLD.status IS DISTINCT FROM NEW.status AND NEW.kind = 'CLARIFICATION' THEN
        SELECT * INTO STRICT run_row FROM app.agent_run WHERE id = NEW.agent_run_id;
        FOR answer IN SELECT * FROM jsonb_array_elements(NEW.answers) LOOP
            INSERT INTO app.source_message(workspace_id, project_id, run_id, event_key, kind, content, prompt, created_by)
            VALUES (NEW.workspace_id, run_row.project_id, NEW.agent_run_id,
                    'clarification:' || NEW.id || ':' || (answer->>'questionIndex'),
                    'USER_CLARIFICATION', answer->>'answer', NEW.questions->>((answer->>'questionIndex')::integer), (SELECT requested_by FROM app.agent_run_command WHERE run_id = NEW.agent_run_id AND command_type = 'RESUME' ORDER BY created_at DESC LIMIT 1))
            ON CONFLICT (event_key) DO NOTHING;
        END LOOP;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER clarification_source AFTER UPDATE OF status ON app.agent_interruption FOR EACH ROW EXECUTE FUNCTION app.capture_clarification_source();

CREATE FUNCTION app.invalidate_derived_memory() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.kind IN ('PROJECT_INPUT', 'USER_CLARIFICATION', 'REQUIREMENT_CONFIRMATION') THEN
        PERFORM 1 FROM app.workspace WHERE id = NEW.workspace_id FOR UPDATE;
        UPDATE app.document SET confirmation_status = 'superseded', retrieval_eligible = FALSE, updated_at = now(), version = version + 1
        WHERE workspace_id = NEW.workspace_id AND project_id = NEW.project_id AND origin = 'agent' AND confirmation_status <> 'superseded';
        UPDATE app.raptor_index_snapshot SET status = 'SUPERSEDED'
        WHERE id IN (SELECT snapshot_id FROM app.raptor_active_snapshot WHERE workspace_id = NEW.workspace_id);
        DELETE FROM app.raptor_active_snapshot WHERE workspace_id = NEW.workspace_id;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER source_invalidates_memory AFTER INSERT ON app.source_message FOR EACH ROW EXECUTE FUNCTION app.invalidate_derived_memory();
