"""init training_jobs + checkpoints + training_metrics + model_versions + train_workers

B03 训练上下文 (TrainCtx). 3 聚合根: TrainingJob / ModelVersion / TrainWorker.
Revision ID: 003, down_revision: 002
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "003"
down_revision = "002"
branch_labels = ("B03",)
depends_on = None


def upgrade() -> None:
    # === model_versions (B03 聚合根 8, 基础模型版本) ===
    op.create_table(
        "model_versions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("base_model", sa.String(128), nullable=False),  # openvla-7b-oft/octo-base/π0
        sa.Column("version", sa.String(32), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("hyperparams", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("metrics", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("checkpoint_uri", sa.String(1024), nullable=True),
        sa.Column("dataset_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("dataset_version", sa.String(32), nullable=True),
        sa.Column("status", sa.String(32), nullable=False, server_default=sa.text("'training'")),  # training/completed/failed/published
        sa.Column("published_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("published_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.UniqueConstraint("project_id", "base_model", "version", name="uq_model_version"),
    )
    op.create_index("ix_model_versions_project_id", "model_versions", ["project_id"])

    # === training_jobs (B03 聚合根 7) ===
    op.create_table(
        "training_jobs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("base_model", sa.String(128), nullable=False),
        sa.Column("dataset_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("dataset_version", sa.String(32), nullable=True),
        sa.Column("hyperparams", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("gpu_allocation", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("status", sa.String(32), nullable=False, server_default=sa.text("'submitted'")),  # submitted/queued/running/completed/failed/stopped/cancelled
        sa.Column("attempt_id", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("resume_from_checkpoint_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("cost_estimate_usd", sa.Numeric(12, 4), nullable=True),
        sa.Column("cost_actual_usd", sa.Numeric(12, 4), nullable=True),
        sa.Column("mlflow_run_id", sa.String(64), nullable=True),
        sa.Column("error_code", sa.String(64), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("requested_by", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.Column("started_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("completed_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("NOW()")),
    )
    op.create_index("ix_training_jobs_project_id", "training_jobs", ["project_id"])
    op.create_index("ix_training_jobs_status", "training_jobs", ["status"])

    # === checkpoints (B03 实体) ===
    op.create_table(
        "checkpoints",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("training_job_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("training_jobs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("step", sa.Integer(), nullable=False),
        sa.Column("metric", sa.Float(), nullable=True),
        sa.Column("file_uri", sa.String(1024), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=True),
        sa.Column("is_best", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("NOW()")),
    )
    op.create_index("ix_checkpoints_job_id", "checkpoints", ["training_job_id"])

    # === training_metrics (TimescaleDB hypertable) ===
    op.create_table(
        "training_metrics",
        sa.Column("training_job_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("training_jobs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("step", sa.Integer(), nullable=False),
        sa.Column("loss", sa.Float(), nullable=True),
        sa.Column("learning_rate", sa.Float(), nullable=True),
        sa.Column("gpu_util", sa.Float(), nullable=True),
        sa.Column("throughput", sa.Float(), nullable=True),
        sa.Column("timestamp", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.PrimaryKeyConstraint("training_job_id", "step", "timestamp"),
    )

    # === train_workers (B03 聚合根 9, 内部) ===
    op.create_table(
        "train_workers",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("worker_name", sa.String(128), nullable=False, unique=True),
        sa.Column("status", sa.String(32), nullable=False, server_default=sa.text("'idle'")),
        sa.Column("gpu_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("gpu_type", sa.String(64), nullable=True),
        sa.Column("current_job_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("last_heartbeat_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("registered_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("NOW()")),
    )

    # 转 hypertable (TimescaleDB, 失败也允许 — 没装 timescale 的开发环境)
    try:
        op.execute(
            "SELECT create_hypertable('training_metrics', 'timestamp', "
            "chunk_time_interval => INTERVAL '1 day', if_not_exists => TRUE);"
        )
    except Exception:  # noqa: BLE001
        # 非 TimescaleDB 环境 (CI 跑 PG only) 跳过
        pass


def downgrade() -> None:
    op.drop_table("train_workers")
    op.drop_table("training_metrics")
    op.drop_table("checkpoints")
    op.drop_table("training_jobs")
    op.drop_table("model_versions")
