"""Fenced Research leases, shared capacity and conservative budget reservations."""

from alembic import op

revision = "20260903_0007"
down_revision = "20260901_0006"
branch_labels = None
depends_on = None

UPGRADE_SQL = """
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM agent_runtime.agent_scheduler_entry e
        JOIN agent_runtime.agent_task_attempt a USING (attempt_id)
        WHERE e.entry_status IN ('CLAIMED','DISPATCHED')
        AND a.status NOT IN ('COMPLETED','FAILED','CANCELLED','SUPERSEDED')) THEN
        RAISE EXCEPTION 'Stop old dispatchers and reconcile active Research attempts before upgrading';
    END IF;
END $$;
ALTER TABLE agent_runtime.agent_scheduler_entry DROP CONSTRAINT ck_agent_scheduler_entry_claim;
ALTER TABLE agent_runtime.agent_scheduler_entry DROP CONSTRAINT IF EXISTS ck_agent_scheduler_entry_status;
ALTER TABLE agent_runtime.agent_scheduler_entry DROP CONSTRAINT IF EXISTS agent_scheduler_entry_entry_status_check;
UPDATE agent_runtime.agent_scheduler_entry SET entry_status = 'FINISHED',
    claim_id = NULL, claimed_by = NULL, lease_until = NULL WHERE entry_status IN ('CLAIMED','DISPATCHED');
ALTER TABLE agent_runtime.agent_scheduler_entry ADD CONSTRAINT ck_agent_scheduler_entry_status
    CHECK (entry_status IN ('PENDING','CLAIMED','DISPATCHED','CANCELLED','FINISHED'));
ALTER TABLE agent_runtime.agent_scheduler_entry ADD CONSTRAINT ck_agent_scheduler_entry_claim CHECK (
    (entry_status IN ('CLAIMED','DISPATCHED')
        AND claim_id IS NOT NULL AND claimed_by IS NOT NULL AND lease_until IS NOT NULL)
    OR (entry_status NOT IN ('CLAIMED','DISPATCHED')
        AND claim_id IS NULL AND claimed_by IS NULL AND lease_until IS NULL));
CREATE TABLE agent_runtime.agent_research_pool (
    resource_pool VARCHAR(100) PRIMARY KEY,
    worker_count INTEGER NOT NULL CONSTRAINT ck_research_pool_capacity CHECK (worker_count >= 1)
);
CREATE TABLE agent_runtime.agent_research_budget (
    run_id UUID PRIMARY KEY REFERENCES agent_runtime.agent_run_state(run_id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL,
    input_sha256 VARCHAR(64) NOT NULL,
    original_json JSONB NOT NULL, primary_json JSONB NOT NULL, shadow_json JSONB,
    primary_status VARCHAR(20) NOT NULL CONSTRAINT ck_research_budget_primary_status
        CHECK (primary_status IN ('RESERVED','COMPLETED','UNKNOWN')),
    primary_usage_json JSONB, shadow_status VARCHAR(20) NOT NULL CONSTRAINT ck_research_budget_shadow_status
        CHECK (shadow_status IN ('DISABLED','RESERVED','RUNNING','COMPLETED','UNKNOWN')), shadow_usage_json JSONB,
    created_at TIMESTAMPTZ NOT NULL
);
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    # Dropping the reservation ledger could authorize already-spent budgets again.
    raise RuntimeError("Research ownership/budget downgrade requires an audited offline migration")
