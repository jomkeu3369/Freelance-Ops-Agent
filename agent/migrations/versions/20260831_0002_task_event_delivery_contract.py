"""Add task revision, progress fields, and durable event delivery state."""

from alembic import op

revision = "20260831_0002"
down_revision = "20260831_0001"
branch_labels = None
depends_on = None

UPGRADE_SQL = """
ALTER TABLE agent_runtime.agent_task_event
    ALTER COLUMN task_id TYPE UUID USING task_id::uuid,
    ALTER COLUMN attempt_id TYPE UUID USING attempt_id::uuid,
    ADD COLUMN task_revision INTEGER,
    ADD COLUMN phase VARCHAR(100),
    ADD COLUMN milestone VARCHAR(200),
    ADD COLUMN delivery_status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    ADD COLUMN delivery_attempts INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN delivery_available_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN delivery_lease_until TIMESTAMPTZ,
    ADD COLUMN delivered_at TIMESTAMPTZ,
    ADD COLUMN delivery_last_error VARCHAR(500);

UPDATE agent_runtime.agent_task_event event
SET task_revision = task.revision
FROM agent_runtime.agent_task task
WHERE event.task_id = task.task_id
  AND event.run_id = task.run_id;

ALTER TABLE agent_runtime.agent_task_event
    ALTER COLUMN task_revision SET NOT NULL,
    ADD CONSTRAINT fk_agent_task_event_task FOREIGN KEY (task_id, task_revision)
        REFERENCES agent_runtime.agent_task(task_id, revision) ON DELETE CASCADE,
    ADD CONSTRAINT fk_agent_task_event_attempt FOREIGN KEY (attempt_id)
        REFERENCES agent_runtime.agent_task_attempt(attempt_id) ON DELETE CASCADE,
    ADD CONSTRAINT ck_agent_task_event_revision CHECK (task_revision >= 1),
    ADD CONSTRAINT ck_agent_task_event_delivery_status CHECK (
        delivery_status IN ('PENDING','PROCESSING','DELIVERED','FAILED')
    ),
    ADD CONSTRAINT ck_agent_task_event_delivery_attempts CHECK (delivery_attempts >= 0),
    ADD CONSTRAINT ck_agent_task_event_delivery_lease CHECK (
        (delivery_status = 'PROCESSING' AND delivery_lease_until IS NOT NULL)
        OR (delivery_status <> 'PROCESSING' AND delivery_lease_until IS NULL)
    );

CREATE INDEX ix_agent_task_event_delivery
    ON agent_runtime.agent_task_event(delivery_status, delivery_available_at, delivery_lease_until, received_at);
"""

DOWNGRADE_SQL = """
DROP INDEX IF EXISTS agent_runtime.ix_agent_task_event_delivery;
ALTER TABLE agent_runtime.agent_task_event
    DROP CONSTRAINT IF EXISTS fk_agent_task_event_attempt,
    DROP CONSTRAINT IF EXISTS fk_agent_task_event_task,
    DROP CONSTRAINT IF EXISTS ck_agent_task_event_delivery_lease,
    DROP CONSTRAINT IF EXISTS ck_agent_task_event_delivery_attempts,
    DROP CONSTRAINT IF EXISTS ck_agent_task_event_delivery_status,
    DROP CONSTRAINT IF EXISTS ck_agent_task_event_revision,
    DROP COLUMN IF EXISTS delivery_last_error,
    DROP COLUMN IF EXISTS delivered_at,
    DROP COLUMN IF EXISTS delivery_lease_until,
    DROP COLUMN IF EXISTS delivery_available_at,
    DROP COLUMN IF EXISTS delivery_attempts,
    DROP COLUMN IF EXISTS delivery_status,
    DROP COLUMN IF EXISTS milestone,
    DROP COLUMN IF EXISTS phase,
    DROP COLUMN IF EXISTS task_revision,
    ALTER COLUMN attempt_id TYPE VARCHAR(128) USING attempt_id::text,
    ALTER COLUMN task_id TYPE VARCHAR(128) USING task_id::text;
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
