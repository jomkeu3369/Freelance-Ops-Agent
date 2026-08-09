CREATE TABLE app.user_account (
    id UUID PRIMARY KEY,
    external_subject VARCHAR(255) NOT NULL UNIQUE,
    email VARCHAR(320) NOT NULL,
    status VARCHAR(20) NOT NULL CHECK (status IN ('ACTIVE', 'DISABLED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE app.workspace (
    id UUID PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    slug VARCHAR(80) NOT NULL UNIQUE,
    status VARCHAR(20) NOT NULL CHECK (status IN ('ACTIVE', 'ARCHIVED')),
    created_by UUID NOT NULL REFERENCES app.user_account(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE app.workspace_member (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES app.workspace(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES app.user_account(id),
    status VARCHAR(20) NOT NULL CHECK (status IN ('INVITED', 'ACTIVE', 'SUSPENDED', 'LEFT')),
    joined_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT uq_workspace_member_user UNIQUE (workspace_id, user_id),
    CONSTRAINT uq_workspace_member_scope UNIQUE (workspace_id, id)
);

CREATE TABLE app.permission (
    code VARCHAR(100) PRIMARY KEY,
    description VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE app.workspace_role (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES app.workspace(id) ON DELETE CASCADE,
    code VARCHAR(50) NOT NULL,
    display_name VARCHAR(100) NOT NULL,
    system_role BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT uq_workspace_role_code UNIQUE (workspace_id, code),
    CONSTRAINT uq_workspace_role_scope UNIQUE (workspace_id, id)
);

CREATE TABLE app.role_permission (
    workspace_id UUID NOT NULL,
    role_id UUID NOT NULL,
    permission_code VARCHAR(100) NOT NULL REFERENCES app.permission(code),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (role_id, permission_code),
    CONSTRAINT fk_role_permission_role_scope
        FOREIGN KEY (workspace_id, role_id)
        REFERENCES app.workspace_role(workspace_id, id)
        ON DELETE CASCADE
);

CREATE TABLE app.member_role (
    workspace_id UUID NOT NULL,
    membership_id UUID NOT NULL,
    role_id UUID NOT NULL,
    assigned_by UUID NOT NULL REFERENCES app.user_account(id),
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (membership_id, role_id),
    CONSTRAINT fk_member_role_membership_scope
        FOREIGN KEY (workspace_id, membership_id)
        REFERENCES app.workspace_member(workspace_id, id)
        ON DELETE CASCADE,
    CONSTRAINT fk_member_role_role_scope
        FOREIGN KEY (workspace_id, role_id)
        REFERENCES app.workspace_role(workspace_id, id)
        ON DELETE CASCADE
);

CREATE TABLE app.rbac_audit_event (
    id UUID PRIMARY KEY,
    workspace_id UUID,
    actor_user_id UUID,
    action VARCHAR(100) NOT NULL,
    outcome VARCHAR(40) NOT NULL,
    permission_code VARCHAR(100),
    target_type VARCHAR(80),
    target_id UUID,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX ix_workspace_member_active_user
    ON app.workspace_member(user_id, workspace_id)
    WHERE status = 'ACTIVE';
CREATE INDEX ix_member_role_workspace_membership
    ON app.member_role(workspace_id, membership_id);
CREATE INDEX ix_role_permission_workspace_role
    ON app.role_permission(workspace_id, role_id);
CREATE INDEX ix_rbac_audit_workspace_time
    ON app.rbac_audit_event(workspace_id, occurred_at DESC);

INSERT INTO app.permission (code, description) VALUES
    ('workspace.read', 'Read workspace profile'),
    ('workspace.update', 'Update workspace settings'),
    ('workspace.delete', 'Delete workspace'),
    ('workspace.transfer_ownership', 'Transfer workspace ownership'),
    ('member.read', 'Read workspace members'),
    ('member.manage', 'Invite, update, or remove members'),
    ('role.read', 'Read roles and effective permissions'),
    ('role.manage', 'Create roles and change role assignments'),
    ('client.read', 'Read clients'),
    ('client.write', 'Create or update clients'),
    ('client.delete', 'Delete clients'),
    ('project.read', 'Read projects'),
    ('project.write', 'Create or update projects'),
    ('project.delete', 'Delete projects'),
    ('document.read', 'Read documents'),
    ('document.write', 'Create or update documents'),
    ('document.delete', 'Delete documents'),
    ('quotation.read', 'Read quotations'),
    ('quotation.write', 'Create quotation drafts and revisions'),
    ('quotation.approve', 'Approve quotations'),
    ('quotation.publish', 'Publish quotations'),
    ('agent.run', 'Start Agent runs'),
    ('agent.respond', 'Respond to Agent interruptions'),
    ('agent.cancel', 'Cancel Agent runs'),
    ('outcome.read', 'Read project outcomes'),
    ('outcome.write', 'Create or update project outcomes'),
    ('integration.read', 'Read integration state'),
    ('integration.manage', 'Manage integrations'),
    ('audit.read', 'Read audit events'),
    ('data.export', 'Export workspace data'),
    ('data.delete', 'Permanently delete workspace data');
