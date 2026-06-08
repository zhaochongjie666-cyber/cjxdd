"""init audit_logs + users + api_keys

AuditCtx 审计上下文. 2 聚合根: AuditLog / User.
Revision ID: 006, down_revision: 005
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "006"
down_revision = "005"
branch_labels = ("AuditCtx",)
depends_on = None


def upgrade() -> None:
    # === users (AuditCtx 聚合根 12, 跨 BXX 引用) ===
    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("email", sa.String(255), nullable=False, unique=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("hashed_password", sa.String(255), nullable=True),
        sa.Column("role", sa.String(32), nullable=False, server_default=sa.text("'viewer'")),  # admin/researcher/engineer/viewer
        sa.Column("mfa_enabled", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("mfa_secret", sa.String(64), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("last_login_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("NOW()")),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)

    # === api_keys (X-R01 API Key 认证) ===
    op.create_table(
        "api_keys",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("key_hash", sa.String(128), nullable=False, unique=True),  # SHA256, 原 key 不存
        sa.Column("key_prefix", sa.String(16), nullable=False),  # 前 8 位, 用于 UI 识别
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("scopes", postgresql.ARRAY(sa.String()), nullable=True),  # sim:read / sim:write / train:read / ...
        sa.Column("last_used_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("expires_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("revoked", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("NOW()")),
    )
    op.create_index("ix_api_keys_user_id", "api_keys", ["user_id"])

    # === audit_logs (AuditCtx 聚合根 13, X-R10) ===
    op.create_table(
        "audit_logs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("ts", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.Column("actor_id", postgresql.UUID(as_uuid=True), nullable=True),  # 允许 NULL (system 行为)
        sa.Column("actor_type", sa.String(32), nullable=False, server_default=sa.text("'user'")),  # user/system/api_key
        sa.Column("action", sa.String(128), nullable=False),  # create / read / update / delete / execute
        sa.Column("target_type", sa.String(64), nullable=False),  # sim_job / collection_session / training_job / ...
        sa.Column("target_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("result", sa.String(32), nullable=False),  # success / denied / failed
        sa.Column("ip_address", sa.String(64), nullable=True),
        sa.Column("user_agent", sa.String(512), nullable=True),
        sa.Column("request_id", sa.String(64), nullable=True),
        sa.Column("details", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.create_index("ix_audit_logs_actor_id", "audit_logs", ["actor_id"])
    op.create_index("ix_audit_logs_target", "audit_logs", ["target_type", "target_id"])
    op.create_index("ix_audit_logs_project_id", "audit_logs", ["project_id"])
    op.create_index("ix_audit_logs_ts", "audit_logs", ["ts"])

    # === user_project_roles (X-R02 RBAC, 多对多) ===
    op.create_table(
        "user_project_roles",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("role", sa.String(32), nullable=False),  # project_admin / project_editor / project_viewer
        sa.Column("granted_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.Column("granted_by", postgresql.UUID(as_uuid=True), nullable=False),
        sa.UniqueConstraint("user_id", "project_id", "role", name="uq_user_project_role"),
    )
    op.create_index("ix_user_project_roles_user_id", "user_project_roles", ["user_id"])


def downgrade() -> None:
    op.drop_table("user_project_roles")
    op.drop_table("audit_logs")
    op.drop_table("api_keys")
    op.drop_table("users")
