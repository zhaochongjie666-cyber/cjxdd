"""xdd workflow CLI 入口 + 验收循环。

按序调 claude CLI 跑八节点(brainstorm→...→verify),verify 当验收闸,
未过则走 xdd-init --iter N+1 迁移(归档旧 iter,design 不动),在新 iter 重跑
plan→execute→verify,直到通过或达 MAX_ITER。

@implements B01-R04 验收走 iter 迁移
@implements B01-R05 迁移后重跑
"""
from __future__ import annotations

import argparse
import logging
import subprocess
import sys
from pathlib import Path
from typing import Callable

from .claude_runner import run_agent_stream
from .gate import gate_check
from .iter_utils import current_iter
from .models import MODEL_ENVS, DEFAULT_MODEL, available_models
from .nodes import build_nodes, node_prompt

# iter 迁移上限(防验收永不收敛死循环)。@covers B01-R04 resilience F07
MAX_ITER = 5

# xdd-init 脚本位置(仓库根 skills/xdd-init/scripts/init.sh)
_INIT_SH = Path(__file__).resolve().parent.parent / "skills" / "xdd-init" / "scripts" / "init.sh"


def migrate_iter(task_dir, n: int) -> bool:
    """调 xdd-init --iter N 做 iter 迁移。返回是否成功。

    @implements B01-R04 归档旧 iter(iter-N 保留)+ 建 iter-N + design 不动
    """
    if not _INIT_SH.exists():
        logging.error("找不到 init.sh: %s", _INIT_SH)
        return False
    logging.info("=== iter 迁移: → iter-%d ===", n)
    r = subprocess.run(["bash", str(_INIT_SH), "--iter", str(n)], cwd=str(task_dir))
    if r.returncode != 0:
        logging.error("iter 迁移失败(returncode=%d)", r.returncode)
        return False
    return True


def gate_passes(task_dir, verify_doc: str) -> bool:
    """检查 verify 产出是否过 gate。@implements B01-R03"""
    od = Path(verify_doc)
    if not od.is_absolute():
        od = Path(task_dir) / od
    passed, stats = gate_check(od)
    logging.info("验收状态: 已完成=%d, 未完成=%d (%s)", stats["completed"], stats["incomplete"], od.name)
    return passed


def run_node(node: dict, task_dir, iter_n: int, bizline: str, model: str,
             stop_check: Callable[[], bool] | None = None) -> bool:
    """跑单个节点:构造 prompt → 调 claude → 返回是否成功。

    @implements B01-R02(prompt 由 node_prompt 注入上下文)
    """
    prompt = node_prompt(node, task_dir, iter_n, bizline)
    logging.info("\n%s\n▶ Agent: %s (Model: %s)\n%s", "═" * 60, node["name"], model, "═" * 60)
    success = True
    for ev in run_agent_stream(node["name"], prompt, task_dir, model=model, stop_check=stop_check):
        if ev["type"] == "log":
            logging.info("%s", ev["text"])
        elif ev["type"] == "timeout":
            logging.error("✗ 节点 %s 超时(%ss)", node["name"], ev["timeout"])
            success = False
        elif ev["type"] == "stopped":
            logging.warning("⚠ 节点 %s 被停止", node["name"])
            success = False
        elif ev["type"] == "success":
            success = ev.get("success", True)
    return success


def workflow_loop(task_dir, bizline: str = "B01", model: str = DEFAULT_MODEL,
                  force: bool = False,
                  run_node_fn: Callable = run_node,
                  migrate_fn: Callable = migrate_iter,
                  gate_fn: Callable = gate_passes) -> bool:
    """主循环:跑八节点 → verify 没过则 iter 迁移重跑。

    可注入 run_node_fn/migrate_fn/gate_fn 便于测试。

    @implements B01-R04/R05
    """
    task_dir = Path(task_dir)
    iter_n = current_iter(task_dir)
    logging.info("=== 起点 iter-%d,业务线 %s ===", iter_n, bizline)

    while iter_n <= MAX_ITER:
        nodes = build_nodes(task_dir, bizline=bizline, iter_n=iter_n)
        for node in nodes:
            out = Path(node["output_doc"])
            if not out.is_absolute():
                out = task_dir / out
            # force=False 且产物已存在 → 跳过(verify 总跑,因要判 gate)
            if not force and out.exists() and node["name"] != "verify":
                logging.info("→ 跳过 %s(%s 已存在,加 -f 强制重跑)", node["name"], out.name)
                continue
            ok = run_node_fn(node, task_dir, iter_n, bizline, model)
            if not ok:
                logging.error("✗ 节点 %s 失败,workflow 中止", node["name"])
                return False

        # verify gate 检查
        verify_node = next(n for n in nodes if n["name"] == "verify")
        if gate_fn(task_dir, verify_node["output_doc"]):
            logging.info("\n✓ iter-%d 验收通过(verify 自检清单全过)", iter_n)
            return True

        # 未过 → iter 迁移重跑 @B01-R04/R05
        if iter_n >= MAX_ITER:
            logging.warning("\n⚠ 达 MAX_ITER=%d,verify 仍未过,疑似无法收敛。检查 verify gate 条件。", MAX_ITER)
            return False
        iter_n += 1
        if not migrate_fn(task_dir, iter_n):
            logging.error("iter 迁移失败,workflow 中止")
            return False
        logging.info("=== 在 iter-%d 重跑 plan→execute→verify 修复未过项 ===", iter_n)
        # 回 while 顶部:build_nodes 会用新 iter_n,产物路径变 iter-N+1,
        # 已有产物跳过逻辑让 plan/execute/verify 重跑(新 iter 目录为空)

    return False


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        description="xdd workflow CLI 调度器(八节点 + 验收循环)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="示例:\n  python -m workflow.run_workflow -t demo/my-project -m YACC\n  -f 强制重跑",
    )
    parser.add_argument("-t", "--task_dir", required=True, help="项目目录(须含 prd.md)")
    keys = available_models()
    parser.add_argument("-m", "--model", default=DEFAULT_MODEL, choices=keys or None,
                        help=f"模型(默认 {DEFAULT_MODEL})")
    parser.add_argument("-b", "--bizline", default="B01", help="业务线 slug(默认 B01)")
    parser.add_argument("-f", "--force", action="store_true", help="忽略已有产物全重跑")
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s",
                        datefmt="%H:%M:%S")

    task_dir = Path(args.task_dir)
    if not task_dir.exists():
        logging.error("任务目录不存在: %s", task_dir)
        return 1
    if not (task_dir / "prd.md").exists():
        logging.error("缺需求文档: %s/prd.md", task_dir)
        return 1

    ok = workflow_loop(task_dir, bizline=args.bizline, model=args.model, force=args.force)
    if ok:
        logging.info("\n🎉 xdd workflow 全部完成,验收通过")
        return 0
    logging.error("\n✗ workflow 未通过")
    return 1


if __name__ == "__main__":
    sys.exit(main())
