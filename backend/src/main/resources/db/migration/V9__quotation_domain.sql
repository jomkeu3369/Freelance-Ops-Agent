CREATE TABLE app.rate_card (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES app.workspace(id) ON DELETE CASCADE,
    name VARCHAR(120) NOT NULL,
    unit VARCHAR(20) NOT NULL CHECK (unit IN ('HOUR', 'DAY', 'FIXED')),
    rate NUMERIC(19, 2) NOT NULL CHECK (rate >= 0),
    minimum_amount NUMERIC(19, 2) NOT NULL DEFAULT 0 CHECK (minimum_amount >= 0),
    currency VARCHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by UUID NOT NULL REFERENCES app.user_account(id),
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT uq_rate_card_workspace_id UNIQUE (workspace_id, id)
);

CREATE TABLE app.estimation_policy (
    workspace_id UUID PRIMARY KEY REFERENCES app.workspace(id) ON DELETE CASCADE,
    default_tax_rate NUMERIC(7, 6) NOT NULL DEFAULT 0 CHECK (default_tax_rate BETWEEN 0 AND 1),
    default_risk_buffer_rate NUMERIC(7, 6) NOT NULL DEFAULT 0 CHECK (default_risk_buffer_rate BETWEEN 0 AND 1),
    maximum_discount_rate NUMERIC(7, 6) NOT NULL DEFAULT 0.3 CHECK (maximum_discount_rate BETWEEN 0 AND 1),
    created_by UUID NOT NULL REFERENCES app.user_account(id),
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    version BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE app.quotation (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL,
    project_id UUID NOT NULL,
    series_id UUID NOT NULL,
    previous_version_id UUID,
    version_number INTEGER NOT NULL CHECK (version_number > 0),
    scenario VARCHAR(20) NOT NULL CHECK (scenario IN ('LEAN', 'RECOMMENDED', 'EXPANDED')),
    status VARCHAR(20) NOT NULL CHECK (status IN ('DRAFT', 'PUBLISHED', 'SUPERSEDED')),
    currency VARCHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    subtotal NUMERIC(19, 2) NOT NULL CHECK (subtotal >= 0),
    discount_total NUMERIC(19, 2) NOT NULL CHECK (discount_total >= 0),
    risk_buffer_rate NUMERIC(7, 6) NOT NULL CHECK (risk_buffer_rate BETWEEN 0 AND 1),
    risk_buffer_amount NUMERIC(19, 2) NOT NULL CHECK (risk_buffer_amount >= 0),
    tax_rate NUMERIC(7, 6) NOT NULL CHECK (tax_rate BETWEEN 0 AND 1),
    tax_amount NUMERIC(19, 2) NOT NULL CHECK (tax_amount >= 0),
    total NUMERIC(19, 2) NOT NULL CHECK (total >= 0),
    valid_until DATE,
    published_at TIMESTAMPTZ,
    published_by UUID REFERENCES app.user_account(id),
    created_by UUID NOT NULL REFERENCES app.user_account(id),
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT fk_quotation_project_scope FOREIGN KEY (workspace_id, project_id)
        REFERENCES app.project(workspace_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_quotation_previous_scope FOREIGN KEY (workspace_id, previous_version_id)
        REFERENCES app.quotation(workspace_id, id),
    CONSTRAINT uq_quotation_series_version UNIQUE (series_id, version_number),
    CONSTRAINT uq_quotation_workspace_id UNIQUE (workspace_id, id)
);

CREATE TABLE app.quotation_assumption (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL,
    quotation_id UUID NOT NULL,
    content VARCHAR(3000) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT fk_quotation_assumption_scope FOREIGN KEY (workspace_id, quotation_id)
        REFERENCES app.quotation(workspace_id, id) ON DELETE CASCADE,
    CONSTRAINT uq_quotation_assumption_quote_id UNIQUE (quotation_id, id)
);

CREATE TABLE app.quotation_evidence (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL,
    quotation_id UUID NOT NULL,
    source_type VARCHAR(30) NOT NULL CHECK (source_type IN ('PAST_PROJECT', 'POLICY', 'PLATFORM_TERMS', 'USER_TEMPLATE', 'EXTERNAL_SOURCE')),
    source_reference VARCHAR(1000) NOT NULL,
    title VARCHAR(300),
    excerpt VARCHAR(3000) NOT NULL,
    retrieved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT fk_quotation_evidence_scope FOREIGN KEY (workspace_id, quotation_id)
        REFERENCES app.quotation(workspace_id, id) ON DELETE CASCADE,
    CONSTRAINT uq_quotation_evidence_quote_id UNIQUE (quotation_id, id)
);

CREATE TABLE app.quotation_item (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL,
    quotation_id UUID NOT NULL,
    rate_card_id UUID,
    title VARCHAR(200) NOT NULL,
    description VARCHAR(5000),
    quantity NUMERIC(19, 4) NOT NULL CHECK (quantity > 0),
    unit VARCHAR(20) NOT NULL CHECK (unit IN ('HOUR', 'DAY', 'FIXED')),
    unit_rate NUMERIC(19, 2) NOT NULL CHECK (unit_rate >= 0),
    subtotal NUMERIC(19, 2) NOT NULL CHECK (subtotal >= 0),
    discount_rate NUMERIC(7, 6) NOT NULL CHECK (discount_rate BETWEEN 0 AND 1),
    discount_amount NUMERIC(19, 2) NOT NULL CHECK (discount_amount >= 0),
    total NUMERIC(19, 2) NOT NULL CHECK (total >= 0),
    assumption_id UUID,
    evidence_id UUID,
    sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
    created_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT fk_quotation_item_scope FOREIGN KEY (workspace_id, quotation_id)
        REFERENCES app.quotation(workspace_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_quotation_item_rate_card_scope FOREIGN KEY (workspace_id, rate_card_id)
        REFERENCES app.rate_card(workspace_id, id),
    CONSTRAINT fk_quotation_item_assumption FOREIGN KEY (quotation_id, assumption_id)
        REFERENCES app.quotation_assumption(quotation_id, id),
    CONSTRAINT fk_quotation_item_evidence FOREIGN KEY (quotation_id, evidence_id)
        REFERENCES app.quotation_evidence(quotation_id, id),
    CONSTRAINT uq_quotation_item_workspace_id UNIQUE (workspace_id, id),
    CONSTRAINT ck_quotation_item_basis CHECK (
        (assumption_id IS NOT NULL AND evidence_id IS NULL)
        OR (assumption_id IS NULL AND evidence_id IS NOT NULL)
    )
);

CREATE TABLE app.quotation_decision (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL,
    quotation_id UUID NOT NULL,
    decision VARCHAR(30) NOT NULL CHECK (decision IN ('APPROVED', 'CHANGES_REQUESTED', 'REJECTED')),
    comment VARCHAR(3000),
    decided_by UUID NOT NULL REFERENCES app.user_account(id),
    created_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT fk_quotation_decision_scope FOREIGN KEY (workspace_id, quotation_id)
        REFERENCES app.quotation(workspace_id, id) ON DELETE CASCADE
);

CREATE INDEX ix_rate_card_workspace_active ON app.rate_card(workspace_id, active, name);
CREATE INDEX ix_quotation_project_created ON app.quotation(workspace_id, project_id, created_at DESC);
CREATE INDEX ix_quotation_item_quote ON app.quotation_item(workspace_id, quotation_id, sort_order);
CREATE INDEX ix_quotation_decision_quote ON app.quotation_decision(workspace_id, quotation_id, created_at DESC);
