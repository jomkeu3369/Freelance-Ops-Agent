"""Add checkpoint, retry budget, and provider circuit reliability state."""

from alembic import op

revision = "20260901_0004"
down_revision = "20260901_0003"
branch_labels = None
depends_on = None

UPGRADE_SQL = """
ALTER TABLE agent_runtime.agent_task_attempt
    ADD COLUMN checkpoint_id VARCHAR(128),
    ADD COLUMN checkpoint_artifact_reference VARCHAR(500),
    ADD COLUMN resume_token_hash VARCHAR(64),
    ADD COLUMN checkpoint_restored_seconds DOUBLE PRECISION NOT NULL DEFAULT 0,
    ADD COLUMN completed_steps JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN side_effect_idempotency_keys JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN failure_classification VARCHAR(40),
    ADD COLUMN classification_confidence DOUBLE PRECISION,
    ADD COLUMN classifier_version VARCHAR(100),
    ADD COLUMN retry_decision VARCHAR(20),
    ADD COLUMN retry_reason VARCHAR(80),
    ADD COLUMN retry_ready_at TIMESTAMPTZ,
    ADD COLUMN retry_snapshot JSONB;

ALTER TABLE agent_runtime.agent_task_attempt
    ADD CONSTRAINT ck_agent_task_attempt_checkpoint_pair CHECK (
        (checkpoint_id IS NULL AND checkpoint_artifact_reference IS NULL AND resume_token_hash IS NULL)
        OR (checkpoint_id IS NOT NULL AND checkpoint_artifact_reference IS NOT NULL AND resume_token_hash IS NOT NULL)
    ),
    ADD CONSTRAINT ck_agent_task_attempt_checkpoint_restored CHECK (checkpoint_restored_seconds >= 0),
    ADD CONSTRAINT ck_agent_task_attempt_classification_confidence CHECK (
        classification_confidence IS NULL OR classification_confidence BETWEEN 0 AND 1
    ),
    ADD CONSTRAINT ck_agent_task_attempt_retry_decision CHECK (
        retry_decision IS NULL OR retry_decision IN ('ALLOW','DENY')
    );

CREATE TABLE agent_runtime.agent_retry_bucket (
    bucket_key VARCHAR(200) PRIMARY KEY,
    scope_type VARCHAR(20) NOT NULL CHECK (scope_type IN ('GLOBAL','WORKSPACE')),
    workspace_id UUID,
    capacity DOUBLE PRECISION NOT NULL CHECK (capacity > 0),
    tokens DOUBLE PRECISION NOT NULL CHECK (tokens >= 0 AND tokens <= capacity),
    refill_per_second DOUBLE PRECISION NOT NULL CHECK (refill_per_second >= 0),
    refilled_at TIMESTAMPTZ NOT NULL,
    policy_version VARCHAR(100) NOT NULL,
    CONSTRAINT ck_agent_retry_bucket_scope CHECK (
        (scope_type = 'GLOBAL' AND workspace_id IS NULL)
        OR (scope_type = 'WORKSPACE' AND workspace_id IS NOT NULL)
    )
);

ALTER TABLE agent_runtime.agent_retry_bucket ADD CONSTRAINT uq_agent_retry_bucket_workspace UNIQUE (workspace_id);

CREATE TABLE agent_runtime.agent_provider_circuit (
    circuit_key VARCHAR(200) PRIMARY KEY,
    provider VARCHAR(30) NOT NULL,
    model VARCHAR(100) NOT NULL,
    state VARCHAR(20) NOT NULL CHECK (state IN ('CLOSED','OPEN','HALF_OPEN')),
    opened_at TIMESTAMPTZ,
    probe_after TIMESTAMPTZ,
    policy_version VARCHAR(100) NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT uq_agent_provider_circuit_identity UNIQUE (provider, model),
    CONSTRAINT ck_agent_provider_circuit_open CHECK (
        (state = 'CLOSED' AND opened_at IS NULL AND probe_after IS NULL)
        OR (state IN ('OPEN','HALF_OPEN') AND opened_at IS NOT NULL AND probe_after IS NOT NULL)
    )
);
"""

DOWNGRADE_SQL = """
DROP TABLE IF EXISTS agent_runtime.agent_provider_circuit;
DROP TABLE IF EXISTS agent_runtime.agent_retry_bucket;
ALTER TABLE agent_runtime.agent_task_attempt
    DROP CONSTRAINT IF EXISTS ck_agent_task_attempt_retry_decision,
    DROP CONSTRAINT IF EXISTS ck_agent_task_attempt_classification_confidence,
    DROP CONSTRAINT IF EXISTS ck_agent_task_attempt_checkpoint_restored,
    DROP CONSTRAINT IF EXISTS ck_agent_task_attempt_checkpoint_pair,
    DROP COLUMN IF EXISTS retry_snapshot,
    DROP COLUMN IF EXISTS retry_ready_at,
    DROP COLUMN IF EXISTS retry_reason,
    DROP COLUMN IF EXISTS retry_decision,
    DROP COLUMN IF EXISTS classifier_version,
    DROP COLUMN IF EXISTS classification_confidence,
    DROP COLUMN IF EXISTS failure_classification,
    DROP COLUMN IF EXISTS side_effect_idempotency_keys,
    DROP COLUMN IF EXISTS completed_steps,
    DROP COLUMN IF EXISTS checkpoint_restored_seconds,
    DROP COLUMN IF EXISTS resume_token_hash,
    DROP COLUMN IF EXISTS checkpoint_artifact_reference,
    DROP COLUMN IF EXISTS checkpoint_id;
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
