"""RBAC 角色权限矩阵 (X-R05).

6 业务角色 + 3 跨业务角色, 共 9 个.
权限矩阵: action × role 映射.

简化为: 角色字符串 → 允许的 action 集合.
生产环境用 Casbin 加载 .conf 模型文件, Phase 5 先在内存中做匹配.
"""
from __future__ import annotations

from enum import Enum

from vla_common.errors import ErrorCode, VLAError


class Role(str, Enum):
    """VLA 平台角色 (9 个)."""

    SIM_ENGINEER = "sim_engineer"  # B01 仿真工程师
    TELEOP_OPERATOR = "teleop_operator"  # B02 遥操员
    DEVICE_MAINTAINER = "device_maintainer"  # B02 设备维护
    ANNOTATOR = "annotator"  # B02 标注员
    RESEARCHER = "researcher"  # B03 训练研究员
    EVALUATOR = "evaluator"  # B04 评测工程师
    DATA_PM = "data_pm"  # 数据 PM (跨业务)
    PM = "pm"  # 产品 PM (跨业务)
    SRE = "sre"  # SRE (跨业务)
    ADMIN = "admin"  # 平台管理员 (X-R05 bypass)


# === Action → 允许角色映射 ===
# action 是 "verb_resource" 形式 (e.g. "create_sim_job")
ACTION_ROLES: dict[str, frozenset[Role]] = {
    # B01 仿真
    "create_sim_job": frozenset({Role.SIM_ENGINEER, Role.PM, Role.ADMIN}),
    "cancel_sim_job": frozenset({Role.SIM_ENGINEER, Role.PM, Role.ADMIN}),
    "view_sim_job": frozenset({Role.SIM_ENGINEER, Role.PM, Role.ADMIN, Role.RESEARCHER}),
    "upload_scene_asset": frozenset({Role.SIM_ENGINEER, Role.ADMIN}),
    # B02 采集
    "create_collection_session": frozenset({Role.TELEOP_OPERATOR, Role.DATA_PM, Role.ADMIN}),
    "submit_annotation": frozenset({Role.ANNOTATOR, Role.TELEOP_OPERATOR, Role.ADMIN}),
    "publish_dataset_version": frozenset({Role.DATA_PM, Role.ADMIN}),
    "view_collection_session": frozenset(
        {Role.TELEOP_OPERATOR, Role.ANNOTATOR, Role.DATA_PM, Role.PM, Role.ADMIN}
    ),
    # B03 训练
    "submit_training_job": frozenset({Role.RESEARCHER, Role.PM, Role.ADMIN}),
    "stop_training_job": frozenset({Role.RESEARCHER, Role.PM, Role.ADMIN}),
    "publish_model_version": frozenset({Role.RESEARCHER, Role.ADMIN}),
    "view_training_job": frozenset({Role.RESEARCHER, Role.PM, Role.ADMIN, Role.EVALUATOR}),
    # B04 评测
    "submit_eval_job": frozenset({Role.EVALUATOR, Role.RESEARCHER, Role.PM, Role.ADMIN}),
    "cancel_eval_job": frozenset({Role.EVALUATOR, Role.RESEARCHER, Role.PM, Role.ADMIN}),
    "publish_eval_report": frozenset({Role.EVALUATOR, Role.ADMIN}),
    "view_eval_job": frozenset({Role.EVALUATOR, Role.PM, Role.ADMIN, Role.RESEARCHER}),
    # 跨业务
    "start_pipeline_run": frozenset({Role.PM, Role.DATA_PM, Role.ADMIN}),
    "view_pipeline_run": frozenset(
        {Role.PM, Role.DATA_PM, Role.SRE, Role.ADMIN, Role.SIM_ENGINEER, Role.RESEARCHER, Role.EVALUATOR}
    ),
    "view_audit_log": frozenset({Role.SRE, Role.ADMIN}),
    "view_dashboard": frozenset(
        {Role.PM, Role.DATA_PM, Role.SRE, Role.ADMIN, Role.SIM_ENGINEER, Role.RESEARCHER, Role.EVALUATOR}
    ),
}


def check_permission(*, role: str, action: str) -> None:
    """检查权限, 不通过抛 VLAError (403)."""
    if role == Role.ADMIN.value:
        return  # admin bypass
    try:
        role_enum = Role(role)
    except ValueError:
        raise VLAError(
            ErrorCode.X_RBAC_FORBIDDEN,
            f"未知角色 '{role}'",
            status_code=403,
            details={"role": role, "action": action},
        )

    allowed = ACTION_ROLES.get(action, frozenset())
    if role_enum not in allowed:
        raise VLAError(
            ErrorCode.X_RBAC_FORBIDDEN,
            f"角色 '{role}' 无权执行 '{action}', 需要 {[r.value for r in allowed] if allowed else '任意已注册角色'}",
            status_code=403,
            details={"role": role, "action": action, "required_roles": [r.value for r in allowed]},
        )


def roles_for_action(action: str) -> list[str]:
    """查询某 action 允许的角色 (用于前端展示)."""
    return sorted(r.value for r in ACTION_ROLES.get(action, frozenset()))
