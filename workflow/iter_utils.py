"""读 .xdd/current-iteration 解析 iter 号。

iter 号是产物路径 runs/iter-{N}/ 的 N。从 current-iteration 文件读,
缺失/损坏时回退默认 1。

@implements B01-R06 iter 号从 current-iteration 读取
"""
from __future__ import annotations

import logging
import re
from pathlib import Path

_DEFAULT = 1


def current_iter(task_dir, default: int = _DEFAULT) -> int:
    """读 <task_dir>/.xdd/current-iteration,解析出 iter 数字。

    文件不存在或内容无可解析数字 → 回退 default(默认 1)+ 警告。
    """
    f = Path(task_dir) / ".xdd" / "current-iteration"
    if not f.exists():
        logging.warning("未找到 %s,用默认 iter %d", f, default)
        return default
    content = f.read_text(encoding="utf-8", errors="replace")
    m = re.search(r"(\d+)", content)
    if not m:
        logging.warning("current-iteration 内容无法解析(%r),用默认 iter %d", content.strip(), default)
        return default
    return int(m.group(1))
