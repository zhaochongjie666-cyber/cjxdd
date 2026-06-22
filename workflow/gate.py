"""验收闸:认 □ 和 - [ ] 双符号。

run_workflow 旧版 test_gateway 只认 ASCII `- [ ]`,但 xdd skill 模板自检段用
全角 `□`(U+25A1)。本模块同时认两种,通过条件:未完成=0 且已完成>0。

@implements B01-R03 验收闸认双符号
"""
from __future__ import annotations

import re
from pathlib import Path

# 未完成:ASCII 复选框 或 全角空方框
_INCOMPLETE = re.compile(r"^\s*[-*]?\s*\[\s\]|^\s*□", re.MULTILINE)
# 已完成:ASCII 复选框(勾) 或 全角实心/打勾方框
_COMPLETED = re.compile(r"^\s*[-*]?\s*\[[xX✓✔]\]|^\s*[☑⊠]", re.MULTILINE)


def gate_check(file_path) -> tuple[bool, dict]:
    """检查一份产出自检清单是否全过。

    Returns:
        (passed, stats): passed = (incomplete==0 and completed>0)
        stats = {"completed": n, "incomplete": m, "exists": bool}
    """
    p = Path(file_path)
    if not p.exists():
        return False, {"completed": 0, "incomplete": 0, "exists": False}
    content = p.read_text(encoding="utf-8", errors="replace")
    completed = len(_COMPLETED.findall(content))
    incomplete = len(_INCOMPLETE.findall(content))
    passed = incomplete == 0 and completed > 0
    return passed, {"completed": completed, "incomplete": incomplete, "exists": True}
