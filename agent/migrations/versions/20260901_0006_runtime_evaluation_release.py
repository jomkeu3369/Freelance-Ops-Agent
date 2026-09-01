"""Add versioned runtime evaluation and release registry."""

from alembic import op

revision = "20260901_0006"
down_revision = "20260901_0005"
branch_labels = None
depends_on = None

UPGRADE_SQL = """
CREATE TABLE agent_runtime.agent_runtime_release (
    release_id UUID PRIMARY KEY,
    release_kind VARCHAR(30) NOT NULL CHECK (release_kind IN ('RUNTIME_PREDICTOR','SCHEDULER_POLICY')),
    version VARCHAR(100) NOT NULL,
    resource_pool VARCHAR(100) NOT NULL,
    artifact_reference VARCHAR(500) NOT NULL,
    artifact_sha256 VARCHAR(64) NOT NULL CHECK (artifact_sha256 ~ '^[0-9a-f]{64}$'),
    dataset_fingerprint VARCHAR(64) NOT NULL CHECK (dataset_fingerprint ~ '^[0-9a-f]{64}$'),
    status VARCHAR(20) NOT NULL CHECK (status IN ('SHADOW_ONLY','APPROVED','REJECTED')),
    report_json JSONB NOT NULL,
    policy_version VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    approved_at TIMESTAMPTZ,
    CONSTRAINT uq_agent_runtime_release_version UNIQUE (release_kind, version, resource_pool),
    CONSTRAINT ck_agent_runtime_release_approved CHECK (
        (status = 'APPROVED' AND approved_at IS NOT NULL)
        OR (status <> 'APPROVED' AND approved_at IS NULL)
    )
);

CREATE INDEX ix_agent_runtime_release_pool_status
    ON agent_runtime.agent_runtime_release(resource_pool, release_kind, status, created_at);
"""

DOWNGRADE_SQL = """
DROP TABLE IF EXISTS agent_runtime.agent_runtime_release;
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
