"""init pipeline_runs + stages + saga_compensations

PipeCtx 编排上下文. 1 聚合根: PipelineRun.
Revision ID: 005, down_revision: 004
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "005"
down_revision = "004"
branch_labels = ("PipeCtx",)
depends_on = None


def upgrade() -> None:
    # === pipeline_runs (PipeCtx 聚合根) ===
    op.create_table(
        "pipeline_runs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("pipeline_definition", postgresql.JSONB(astext_type=sa.Text()), nullable=False),  # DAG 定义
        sa.Column("status", sa.String(32), nullable=False, server_default=sa.text("'created'")),  # created/running/succeeded/failed/cancelled
        sa.Column("current_stage", sa.String(64), nullable=True),
        sa.Column("stage_history", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("saga_id", postgresql.UUID(as_uuid=True), nullable=True),  # X-R09 跨业务线 Saga
        sa.Column("error_code", sa.String(64), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("requested_by", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.Column("started_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("completed_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("NOW()")),
    )
    op.create_index("ix_pipeline_runs_project_id", "pipeline_runs", ["project_id"])
    op.create_index("ix_pipeline_runs_status", "pipeline_runs", ["status"])

    # === stages (Stage 实体) ===
    op.create_table(
        "stages",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("pipeline_run_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("pipeline_runs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("stage_name", sa.String(64), nullable=False),
        sa.Column("stage_type", sa.String(32), nullable=False),  # sim/coll/train/eval/transform
        sa.Column("stage_order", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default=sa.text("'pending'")),  # pending/running/succeeded/failed/skipped
        sa.Column("input_ref", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("output_ref", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("error_code", sa.String(64), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("started_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("completed_at", sa.TIMESTAMP(timezone=True), nullable=True),
    )
    op.create_index("ix_stages_pipeline_run_id", "stages", ["pipeline_run_id"])

    # === saga_compensations (X-R09 跨业务线补偿日志) ===
    op.create_table(
        "saga_compensations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("saga_id", postgresql.UUID(as_uuid=True), nullable=False, index=True),
        sa.Column("pipeline_run_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("stage_name", sa.String(64), nullable=False),
        sa.Column("compensated_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.Column("compensation_action", sa.String(128), nullable=False),  # cancel_sim_job / delete_dataset_version / ...
        sa.Column("status", sa.String(32), nullable=False),  # success/failed
        sa.Column("error_message", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("saga_compensations")
    op.drop_table("stages")
    op.drop_table("pipeline_runs")
