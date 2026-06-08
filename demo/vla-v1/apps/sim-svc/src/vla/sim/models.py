"""VLA sim-svc — SQLAlchemy ORM models (向后兼容 alias).

Phase 5 后 ORM 模型统一在 `vla.sim.domain`. 本文件保留 Project/SimJob 导出,
仅作为 backward-compat shim (main.py 仍 import 此处).
"""
from __future__ import annotations

from vla.sim.domain import Project, SimJob  # noqa: F401

__all__ = ["Project", "SimJob"]
