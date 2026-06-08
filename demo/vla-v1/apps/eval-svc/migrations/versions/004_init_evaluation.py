"""init eval_jobs + eval_tasks + eval_results + eval_workers

B04 评测上下文 (EvalCtx). 2 聚合根: EvalJob / EvalWorker.
Revision ID: 004, down_revision: 003
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "004"
down_revision = "003"
branch_labels = ("B04",)
depends_on = None


def upgrade() -> None:
    # === eval_jobs (B04 聚合根 10) ===
    op.create_table(
        "eval_jobs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("model_version_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("benchmark", sa.String(64), nullable=False),  # LIBERO-Spatial / LIBERO-Object / LIBERO-Goal / LIBERO-Long / SimplerEnv
        sa.Column("task_suite", sa.String(64), nullable=False),
        sa.Column("num_trials", sa.Integer(), nullable=False, server_default=sa.text("3")),  # B04-R01 3 trial 中位数
        sa.Column("status", sa.String(32), nullable=False, server_default=sa.text("'created'")),  # created/queued/running/completed/failed/cancelled
        sa.Column("config", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("cost_estimate_usd", sa.Numeric(12, 4), nullable=True),
        sa.Column("cost_actual_usd", sa.Numeric(12, 4), nullable=True),
        sa.Column("error_code", sa.String(64), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("requested_by", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.Column("started_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("completed_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("NOW()")),
    )
    op.create_index("ix_eval_jobs_project_id", "eval_jobs", ["project_id"])
    op.create_index("ix_eval_jobs_benchmark", "eval_jobs", ["benchmark"])

    # === eval_tasks (单个任务) ===
    op.create_table(
        "eval_tasks",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("eval_job_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("eval_jobs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("task_name", sa.String(255), nullable=False),
        sa.Column("task_instruction", sa.Text(), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default=sa.text("'pending'")),  # pending/running/success/failure
        sa.Column("trial_results", postgresql.JSONB(astext_type=sa.Text()), nullable=True),  # [{trial, success, duration_s, ...}]
        sa.Column("success_rate", sa.Float(), nullable=True),  # 3 trial 中位数
        sa.Column("median_duration_s", sa.Float(), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("NOW()")),
    )
    op.create_index("ix_eval_tasks_job_id", "eval_tasks", ["eval_job_id"])

    # === eval_results (汇总报告) ===
    op.create_table(
        "eval_results",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("eval_job_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("eval_jobs.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("overall_success_rate", sa.Float(), nullable=True),
        sa.Column("per_task", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("report_uri", sa.String(1024), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("NOW()")),
    )

    # === eval_workers (B04 聚合根 11, 内部) ===
    op.create_table(
        "eval_workers",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("worker_name", sa.String(128), nullable=False, unique=True),
        sa.Column("status", sa.String(32), nullable=False, server_default=sa.text("'idle'")),
        sa.Column("gpu_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("gpu_type", sa.String(64), nullable=True),
        sa.Column("current_job_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("last_heartbeat_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("registered_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("NOW()")),
    )


def downgrade() -> None:
    op.drop_table("eval_workers")
    op.drop_table("eval_results")
    op.drop_table("eval_tasks")
    op.drop_table("eval_jobs")
