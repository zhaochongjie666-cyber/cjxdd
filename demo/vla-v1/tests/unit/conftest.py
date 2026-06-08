"""conftest — Phase 5 测试全局 fixture + sys.path 注入.

确保所有 unit/chaos/e2e 测试都能 import 各 service 域代码.
"""
from __future__ import annotations

import os
import sys

# 测试统一 SQLite 模式
os.environ.setdefault("VLA_SCAFFOLD_SQLITE", "1")
os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")

# PYTHONPATH: 注入 libs + 所有 app src
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
for sub in (
    "libs/vla-common",
    "libs/vla-db",
    "libs/vla-events",
    "apps/sim-svc/src",
    "apps/pipe-svc/src",
    "apps/eval-svc/src",
    "apps/coll-svc/src",
    "apps/train-svc/src",
    "apps/audit-svc/src",
    "apps/api-gateway/src",
):
    p = os.path.join(ROOT, sub)
    if p not in sys.path:
        sys.path.insert(0, p)
