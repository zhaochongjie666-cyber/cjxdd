"""放宽版验收闸。

run_workflow.test_gateway 只认 ASCII `- [ ]` / `- [x]`,但 xdd skill 模板的
自检段用的是全角方框 `□`(U+25A1)。网页版不改 skill 模板,在这里同时认两种:

- 未完成:行首 `- [ ]` 或 `□`
- 已完成:行首 `- [x]` 或 `☑`/`✔`/`✅`(以及 `□` 被填了 `x` 的形态)

通过条件:未完成数 == 0 且已完成数 > 0(至少勾过一项,全空不算过)。
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

    Args:
        file_path: 产出文档路径(str / Path)。

    Returns:
        (passed, stats):
            passed = (incomplete == 0 and completed > 0)
            stats  = {"completed": n, "incomplete": m, "exists": bool}
    """
    p = Path(file_path)
    if not p.exists():
        return False, {"completed": 0, "incomplete": 0, "exists": False}
    content = p.read_text(encoding="utf-8", errors="replace")
    completed = len(_COMPLETED.findall(content))
    incomplete = len(_INCOMPLETE.findall(content))
    passed = incomplete == 0 and completed > 0
    return passed, {"completed": completed, "incomplete": incomplete, "exists": True}
