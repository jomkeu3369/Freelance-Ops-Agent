"""Preserve the prompt version assigned when a run is created."""

from alembic import op

revision = "20260912_0007"
down_revision = "20260901_0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE agent_runtime.agent_run_state ADD COLUMN prompt_version VARCHAR(100) "
        "NOT NULL DEFAULT 'department-work-product-v1'"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE agent_runtime.agent_run_state DROP COLUMN prompt_version")
