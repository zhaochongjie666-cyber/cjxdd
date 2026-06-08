"""init sim_jobs + scenes + assets + sim_workers

B01 仿真上下文 (SimCtx). 3 聚合根: SimJob / SceneAsset / SimWorker.
Revision ID: 001
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "001"
down_revision = None
branch_labels = ("B01",)
depends_on = None


def upgrade() -> None:
    # === projects (多租户) ===
    op.create_table(
        "projects",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("slug", sa.String(64), nullable=False, unique=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("owner_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("NOW()")),
    )
    op.create_index("ix_projects_owner_id", "projects", ["owner_id"])

    # === scene_assets (B01 聚合根 2) ===
    op.create_table(
        "scene_assets",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("format", sa.String(32), nullable=False),  # usd / mjcf / obj / gltf
        sa.Column("file_uri", sa.String(1024), nullable=False),  # MinIO path
        sa.Column("size_bytes", sa.BigInteger(), nullable=True),
        sa.Column("physics_config", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("uploaded_by", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("uploaded_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.Column("validated", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_index("ix_scene_assets_project_id", "scene_assets", ["project_id"])

    # === sim_jobs (B01 聚合根 1) ===
    op.create_table(
        "sim_jobs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("scene_asset_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("scene_assets.id"), nullable=True),
        sa.Column("task_spec", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("physics_config", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("engine", sa.String(32), nullable=False),  # isaac_sim / mujoco / genesis
        sa.Column("num_episodes", sa.Integer(), nullable=False, server_default=sa.text("1")),
        sa.Column("status", sa.String(32), nullable=False, server_default=sa.text("'created'")),  # created/queued/running/completed/failed/cancelled
        sa.Column("attempt_id", sa.Integer(), nullable=False, server_default=sa.text("0")),
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
    op.create_index("ix_sim_jobs_project_id", "sim_jobs", ["project_id"])
    op.create_index("ix_sim_jobs_status", "sim_jobs", ["status"])
    op.create_index("ix_sim_jobs_requested_by", "sim_jobs", ["requested_by"])

    # === sim_episodes (B01 实体) ===
    op.create_table(
        "sim_episodes",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("sim_job_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("sim_jobs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("episode_index", sa.Integer(), nullable=False),
        sa.Column("video_uri", sa.String(1024), nullable=True),
        sa.Column("obs_uri", sa.String(1024), nullable=True),
        sa.Column("action_uri", sa.String(1024), nullable=True),
        sa.Column("success", sa.Boolean(), nullable=True),
        sa.Column("duration_s", sa.Float(), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.UniqueConstraint("sim_job_id", "episode_index", name="uq_sim_episode_index"),
    )
    op.create_index("ix_sim_episodes_sim_job_id", "sim_episodes", ["sim_job_id"])

    # === sim_workers (B01 聚合根 3, 内部) ===
    op.create_table(
        "sim_workers",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("worker_name", sa.String(128), nullable=False, unique=True),
        sa.Column("status", sa.String(32), nullable=False, server_default=sa.text("'idle'")),  # idle/busy/down
        sa.Column("gpu_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("gpu_type", sa.String(64), nullable=True),
        sa.Column("current_job_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("last_heartbeat_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("registered_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("NOW()")),
    )

    # === sim_worker_attempts (Attempt 实体, 最多 3 次) ===
    op.create_table(
        "sim_worker_attempts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("worker_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("sim_workers.id", ondelete="CASCADE"), nullable=False),
        sa.Column("sim_job_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("sim_jobs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("attempt_no", sa.Integer(), nullable=False),
        sa.Column("started_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.Column("ended_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("error_code", sa.String(64), nullable=True),
    )
    op.create_index("ix_sim_attempts_job_id", "sim_worker_attempts", ["sim_job_id"])


def downgrade() -> None:
    op.drop_table("sim_worker_attempts")
    op.drop_table("sim_workers")
    op.drop_table("sim_episodes")
    op.drop_table("sim_jobs")
    op.drop_table("scene_assets")
    op.drop_table("projects")
