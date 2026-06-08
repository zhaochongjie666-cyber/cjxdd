"""init collection_sessions + devices + dataset_versions + collection_episodes + annotations

B02 采集上下文 (CollCtx). 3 聚合根: CollectionSession / Device / DatasetVersion.
Revision ID: 002, down_revision: 001
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "002"
down_revision = "001"
branch_labels = ("B02",)
depends_on = None


def upgrade() -> None:
    # === devices (B02 聚合根 5) ===
    op.create_table(
        "devices",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("device_type", sa.String(32), nullable=False),  # aloha/bridge/gello/franka/mobile_aloha/so_100
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("hardware_spec", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("status", sa.String(32), nullable=False, server_default=sa.text("'registered'")),  # registered/calibrated/connected/disconnected/error
        sa.Column("last_calibration_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("last_heartbeat_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("owner_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("NOW()")),
    )
    op.create_index("ix_devices_project_id", "devices", ["project_id"])
    op.create_index("ix_devices_status", "devices", ["status"])

    # === collection_sessions (B02 聚合根 4) ===
    op.create_table(
        "collection_sessions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("device_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("devices.id"), nullable=False),
        sa.Column("operator_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("task_spec", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("camera_config", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("status", sa.String(32), nullable=False, server_default=sa.text("'active'")),  # active/paused/ended/failed
        sa.Column("started_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.Column("ended_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("NOW()")),
    )
    op.create_index("ix_coll_sessions_project_id", "collection_sessions", ["project_id"])
    op.create_index("ix_coll_sessions_operator_id", "collection_sessions", ["operator_id"])

    # === collection_episodes (B02 实体) ===
    op.create_table(
        "collection_episodes",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("session_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("collection_sessions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("episode_index", sa.Integer(), nullable=False),
        sa.Column("video_uri", sa.String(1024), nullable=True),
        sa.Column("action_uri", sa.String(1024), nullable=True),
        sa.Column("success_flag", sa.Boolean(), nullable=True),
        sa.Column("quality_score", sa.Float(), nullable=True),
        sa.Column("annotation_status", sa.String(32), nullable=False, server_default=sa.text("'pending'")),  # pending/annotated/approved/rejected
        sa.Column("complete", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.UniqueConstraint("session_id", "episode_index", name="uq_coll_episode_index"),
    )
    op.create_index("ix_coll_episodes_session_id", "collection_episodes", ["session_id"])

    # === annotations (B02 值对象持久化) ===
    op.create_table(
        "annotations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("episode_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("collection_episodes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("annotator_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("task_instruction", sa.Text(), nullable=False),
        sa.Column("success", sa.Boolean(), nullable=True),
        sa.Column("quality_score", sa.Float(), nullable=True),
        sa.Column("failure_reason", sa.Text(), nullable=True),
        sa.Column("tags", postgresql.ARRAY(sa.String()), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("NOW()")),
    )
    op.create_index("ix_annotations_episode_id", "annotations", ["episode_id"])

    # === dataset_versions (B02 聚合根 6) ===
    op.create_table(
        "dataset_versions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("version", sa.String(32), nullable=False),  # semver
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("schema_version", sa.String(32), nullable=False),  # LeRobot 1.0 / RLDS / HDF5
        sa.Column("format", sa.String(32), nullable=False),
        sa.Column("modality", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("license", sa.String(64), nullable=False, server_default=sa.text("'internal'")),
        sa.Column("status", sa.String(32), nullable=False, server_default=sa.text("'draft'")),  # draft/validating/published/archived
        sa.Column("episode_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("total_duration_s", sa.Float(), nullable=True),
        sa.Column("size_bytes", sa.BigInteger(), nullable=True),
        sa.Column("parent_dataset_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("dataset_versions.id"), nullable=True),
        sa.Column("parent_version", sa.String(32), nullable=True),
        sa.Column("published_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("published_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.UniqueConstraint("project_id", "name", "version", name="uq_dataset_version"),
    )
    op.create_index("ix_dataset_versions_project_id", "dataset_versions", ["project_id"])

    # === dataset_episodes (DatasetEpisode 实体) ===
    op.create_table(
        "dataset_episodes",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("dataset_version_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("dataset_versions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("episode_id", postgresql.UUID(as_uuid=True), nullable=False),  # 跨聚合引用
        sa.Column("source_type", sa.String(16), nullable=False),  # sim / real
        sa.Column("source_session_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("annotated_status", sa.String(32), nullable=True),
    )
    op.create_index("ix_dataset_episodes_version_id", "dataset_episodes", ["dataset_version_id"])


def downgrade() -> None:
    op.drop_table("dataset_episodes")
    op.drop_table("dataset_versions")
    op.drop_table("annotations")
    op.drop_table("collection_episodes")
    op.drop_table("collection_sessions")
    op.drop_table("devices")
