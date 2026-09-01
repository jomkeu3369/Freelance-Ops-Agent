"""Add the durable and idempotent Task command inbox."""

from alembic import op

revision = "20260901_0003"
down_revision = "20260831_0002"
branch_labels = None
depends_on = None

UPGRADE_SQL = """
CREATE TABLE agent_runtime.agent_task_command_receipt (
    command_id UUID PRIMARY KEY,
    task_id UUID NOT NULL,
    task_revision INTEGER NOT NULL,
    run_id UUID NOT NULL REFERENCES agent_runtime.agent_run_state(run_id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL,
    attempt_id UUID,
    command_type VARCHAR(30) NOT NULL,
    idempotency_key VARCHAR(128) NOT NULL,
    requested_by UUID NOT NULL,
    requested_at TIMESTAMPTZ NOT NULL,
    authorization_revision BIGINT NOT NULL,
    budget_revision BIGINT NOT NULL,
    payload_json JSONB NOT NULL,
    payload_sha256 VARCHAR(64) NOT NULL,
    status VARCHAR(20) NOT NULL,
    received_at TIMESTAMPTZ NOT NULL,
    applied_at TIMESTAMPTZ,
    CONSTRAINT fk_agent_task_command_receipt_task FOREIGN KEY (task_id, task_revision)
        REFERENCES agent_runtime.agent_task(task_id, revision) ON DELETE CASCADE,
    CONSTRAINT ck_agent_task_command_receipt_status CHECK (status IN ('PENDING','APPLIED','REJECTED')),
    CONSTRAINT ck_agent_task_command_receipt_revision CHECK (
        task_revision >= 1 AND authorization_revision >= 1 AND budget_revision >= 1
    ),
    CONSTRAINT ck_agent_task_command_receipt_applied CHECK (
        (status = 'APPLIED' AND applied_at IS NOT NULL) OR (status <> 'APPLIED' AND applied_at IS NULL)
    )
);

CREATE INDEX ix_agent_task_command_receipt_pending
    ON agent_runtime.agent_task_command_receipt(status, received_at);
"""

DOWNGRADE_SQL = """
DROP TABLE IF EXISTS agent_runtime.agent_task_command_receipt;
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
