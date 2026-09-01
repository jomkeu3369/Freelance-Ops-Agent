"""Add durable FIFO queue and hierarchical scheduler shadow state."""

from alembic import op

revision = "20260901_0005"
down_revision = "20260901_0004"
branch_labels = None
depends_on = None

UPGRADE_SQL = """
CREATE TABLE agent_runtime.agent_scheduler_entry (
    attempt_id UUID PRIMARY KEY REFERENCES agent_runtime.agent_task_attempt(attempt_id) ON DELETE CASCADE,
    task_id UUID NOT NULL,
    task_revision INTEGER NOT NULL,
    workspace_id UUID NOT NULL,
    resource_pool VARCHAR(100) NOT NULL,
    queue_kind VARCHAR(20) NOT NULL CHECK (queue_kind IN ('READY','RETRY')),
    entry_status VARCHAR(20) NOT NULL CHECK (entry_status IN ('PENDING','CLAIMED','DISPATCHED','CANCELLED')),
    priority INTEGER NOT NULL CHECK (priority BETWEEN 1 AND 5),
    predicted_runtime_seconds DOUBLE PRECISION NOT NULL CHECK (predicted_runtime_seconds >= 0),
    predictor_version VARCHAR(100) NOT NULL,
    enqueued_at TIMESTAMPTZ NOT NULL,
    available_at TIMESTAMPTZ NOT NULL CHECK (available_at >= enqueued_at),
    actual_policy_version VARCHAR(100) NOT NULL,
    shadow_policy_version VARCHAR(100) NOT NULL,
    shadow_decision VARCHAR(20) NOT NULL CHECK (shadow_decision IN ('ADMIT','DEFER','REJECT')),
    shadow_reason VARCHAR(80) NOT NULL,
    shadow_available_at TIMESTAMPTZ,
    admission_snapshot JSONB NOT NULL,
    last_actual_rank INTEGER,
    last_shadow_rank INTEGER,
    last_shadow_score DOUBLE PRECISION,
    last_shadow_lane VARCHAR(40),
    claim_id UUID,
    claimed_by VARCHAR(100),
    lease_until TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT ck_agent_scheduler_entry_claim CHECK (
        (entry_status = 'CLAIMED' AND claim_id IS NOT NULL AND claimed_by IS NOT NULL AND lease_until IS NOT NULL)
        OR (entry_status <> 'CLAIMED' AND claim_id IS NULL AND claimed_by IS NULL AND lease_until IS NULL)
    )
);

CREATE INDEX ix_agent_scheduler_entry_pending
    ON agent_runtime.agent_scheduler_entry(resource_pool, entry_status, available_at, enqueued_at);
CREATE INDEX ix_agent_scheduler_entry_workspace_pending
    ON agent_runtime.agent_scheduler_entry(resource_pool, workspace_id, entry_status, available_at);

CREATE TABLE agent_runtime.agent_worker_capacity_event (
    event_id UUID PRIMARY KEY,
    resource_pool VARCHAR(100) NOT NULL,
    worker_count INTEGER NOT NULL CHECK (worker_count >= 1),
    captured_at TIMESTAMPTZ NOT NULL,
    source VARCHAR(100) NOT NULL,
    policy_version VARCHAR(100) NOT NULL
);

CREATE INDEX ix_agent_worker_capacity_event_pool_time
    ON agent_runtime.agent_worker_capacity_event(resource_pool, captured_at);
"""

DOWNGRADE_SQL = """
DROP TABLE IF EXISTS agent_runtime.agent_worker_capacity_event;
DROP TABLE IF EXISTS agent_runtime.agent_scheduler_entry;
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
