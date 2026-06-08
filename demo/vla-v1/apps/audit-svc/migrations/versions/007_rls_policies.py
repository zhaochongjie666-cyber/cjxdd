"""RLS (Row Level Security) policies — X-R03 多租户隔离

为所有含 project_id 字段的表启用 RLS, 强制基于 session 变量 app.current_project_id 隔离.
每个 service 连接时 SET LOCAL app.current_project_id = '<uuid>';

Revision ID: 007, down_revision: 006
"""
from alembic import op

revision = "007"
down_revision = "006"
branch_labels = ("RLS",)
depends_on = None


# 含 project_id 字段的所有表 (Phase 2.7 创建的 14 张 + 4 张)
TABLES_WITH_PROJECT_ID = [
    # B01
    "scene_assets",
    "sim_jobs",
    # B02
    "devices",
    "collection_sessions",
    "dataset_versions",
    # B03
    "model_versions",
    "training_jobs",
    # B04
    "eval_jobs",
    # Pipe
    "pipeline_runs",
    # Audit (project_id 是 nullable, 但同策略)
    "audit_logs",
    "user_project_roles",
]

# Audit 表 (无 project_id) — 用 actor_id 隔离
TABLES_USER_SCOPED = [
    "api_keys",
]


def upgrade() -> None:
    for table in TABLES_WITH_PROJECT_ID:
        # 启用 RLS
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY;")

        # 隔离策略: 仅允许 project_id 匹配 session var 的行可见
        op.execute(f"""
            CREATE POLICY {table}_tenant_isolation ON {table}
            FOR ALL TO PUBLIC
            USING (
                project_id::text = current_setting('app.current_project_id', true)
                OR current_setting('app.bypass_rls', true) = 'on'
            )
            WITH CHECK (
                project_id::text = current_setting('app.current_project_id', true)
                OR current_setting('app.bypass_rls', true) = 'on'
            );
        """)

    for table in TABLES_USER_SCOPED:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY;")
        op.execute(f"""
            CREATE POLICY {table}_user_isolation ON {table}
            FOR ALL TO PUBLIC
            USING (
                user_id::text = current_setting('app.current_user_id', true)
                OR current_setting('app.bypass_rls', true) = 'on'
            )
            WITH CHECK (
                user_id::text = current_setting('app.current_user_id', true)
                OR current_setting('app.bypass_rls', true) = 'on'
            );
        """)

    # users 表: 只允许读自己 + admin 全读
    op.execute("ALTER TABLE users ENABLE ROW LEVEL SECURITY;")
    op.execute("ALTER TABLE users FORCE ROW LEVEL SECURITY;")
    op.execute("""
        CREATE POLICY users_self_or_admin ON users
        FOR ALL TO PUBLIC
        USING (
            id::text = current_setting('app.current_user_id', true)
            OR current_setting('app.is_admin', true) = 'true'
            OR current_setting('app.bypass_rls', true) = 'on'
        )
        WITH CHECK (
            id::text = current_setting('app.current_user_id', true)
            OR current_setting('app.is_admin', true) = 'true'
            OR current_setting('app.bypass_rls', true) = 'on'
        );
    """)


def downgrade() -> None:
    all_tables = TABLES_WITH_PROJECT_ID + TABLES_USER_SCOPED + ["users"]
    for table in all_tables:
        op.execute(f"DROP POLICY IF EXISTS {table}_tenant_isolation ON {table};")
        op.execute(f"DROP POLICY IF EXISTS {table}_user_isolation ON {table};")
        op.execute(f"DROP POLICY IF EXISTS {table}_self_or_admin ON {table};")
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY;")
