#!/usr/bin/env python3
"""
xdd workflow 调度器 —— 外部 Python 编排 xdd 全链
brainstorm → spec → architecture → wire → resilience → plan → execute → verify

照搬外部调度范式（subprocess 调 claude CLI + models.yaml + 验收循环），
流程换成 xdd 八节点，验收闸用各节点产物的 - [ ] 自检清单计数。

用法:
    python workflow/run_workflow.py -t demo/my-project -m YACC
    python workflow/run_workflow.py -t demo/my-project -m YACC -f   # 强制重跑所有节点
"""
import argparse
import json
import logging
import re
import select
import subprocess
import time
import uuid
from datetime import datetime
from pathlib import Path

import yaml


# ==================== 配置 ====================
WORKFLOW_DIR = Path(__file__).parent
PROJECT_ROOT = WORKFLOW_DIR.parent


def load_model_envs():
    """加载模型环境变量配置（models.yaml）"""
    config_file = WORKFLOW_DIR / "models.yaml"
    if not config_file.exists():
        return {}
    with open(config_file, encoding="utf-8") as f:
        config = yaml.safe_load(f)
    return config.get("models", {})


MODEL_ENVS = load_model_envs()
DEFAULT_MODEL = "YACC"

_log_handle = None


def log(msg, task_dir=None):
    global _log_handle
    if task_dir is not None:
        log_file = task_dir / "log" / "task_loop.log"
        if _log_handle is None or _log_handle.name != str(log_file):
            if _log_handle:
                _log_handle.close()
            _log_handle = open(str(log_file), "a")
    print(msg)
    if _log_handle:
        _log_handle.write(str(msg))
        _log_handle.flush()


def parser_msg(data, output_format="text"):
    """解析 Claude 流式响应"""
    msg_type = data.get("type")
    result = None

    def extract_text_thinking(delta):
        if delta.get("text"):
            return delta.get("text")
        if delta.get("thinking"):
            return delta.get("thinking")
        partial = delta.get("partial_json", "")
        if partial:
            partial_str = str(partial)
            if '"text"' in partial_str or '"thinking"' in partial_str:
                return partial
        return None

    if msg_type == "stream_event":
        event = data.get("event", {})
        event_type = event.get("type")
        if event_type in ("content_block_start", "content_block_stop"):
            content = event.get("content_block", {})
            if content.get("type") == "thinking":
                return content.get("thinking") or content.get("text")
            return None
        if event_type in ("content_block_delta", "message_delta"):
            delta = event.get("delta", {})
            if delta.get("partial_json"):
                return delta.get("partial_json")
            result = extract_text_thinking(delta)
            if event_type == "content_block_delta" and delta.get("type") == "input_json_delta":
                partial = delta.get("partial_json", "")
                if partial and ('"text"' in str(partial) or '"thinking"' in str(partial)):
                    result = partial
                else:
                    result = None
            return result
        if event_type in ("message_start", "message_stop"):
            return None
    elif msg_type == "assistant":
        message = data.get("message", {})
        content = message.get("content", [])
        if content:
            last = content[-1]
            if last.get("type") == "tool_use":
                tool_name = last.get("name", "")
                tool_input = last.get("input", {})
                return f"[TOOL: {tool_name}] {tool_input}"
            result = last.get("thinking") or last.get("text")
    elif msg_type == "user":
        message = data.get("message", {})
        content = message.get("content", [])
        if content:
            last = content[-1]
            result = last.get("content") or last.get("text")
            if result:
                return result
    elif msg_type == "result":
        result = data.get("result")
    elif msg_type == "system":
        subtype = data.get("subtype", "")
        hook_name = data.get("hook_name", "unknown")
        if subtype == "hook_started":
            result = f"[HOOK: {hook_name} started]"
        elif subtype == "hook_response":
            output = data.get("output", "")
            result = f"[HOOK: {hook_name} response]" + (f" {output}" if output else "")
        else:
            result = f"[SYSTEM: {subtype}]"

    if output_format == "json" and result:
        try:
            return json.dumps(result, ensure_ascii=False)
        except (TypeError, ValueError):
            return str(result)
    return result


def single_claude(prompt, model=DEFAULT_MODEL):
    """单次 claude 调用（用于轻量判断，如任务是否完成）"""
    claude_env = MODEL_ENVS.get(model, {}).get("env", "")
    if not claude_env:
        logging.info(f"警告: 未找到模型 '{model}' 的环境变量配置，使用默认配置")
    else:
        logging.info(f"已加载模型 '{model}' 环境变量")

    cmd = (
        f"{claude_env} && claude "
        f"--system-prompt '你是高效ai助手，请做最简洁的回答' "
        f"--permission-mode bypassPermissions "
        f'-p " {prompt} " '
    )
    res = subprocess.getoutput(cmd)
    log(res)
    return res


def agent_worker(agent, prompt, task_dir, model=DEFAULT_MODEL,
                 max_retries=200, retry_delay=900, continue_flag=False):
    """执行单个节点 agent，失败重试 max_retries 次"""
    task_dir = Path(task_dir)

    for attempt in range(1, max_retries + 1):
        if attempt > 1:
            logging.warning(
                f"第 {attempt - 1} 次执行失败，{retry_delay // 60} 分钟后重试 "
                f"({attempt - 1}/{max_retries})"
            )
            time.sleep(retry_delay)

        timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        debug_dir = task_dir / "log" / "claude"
        debug_dir.mkdir(parents=True, exist_ok=True)
        debug_file = debug_dir / f"{timestamp}_{agent}_{uuid.uuid4().hex[:8]}.log"

        add_system_prompt_file = WORKFLOW_DIR / "SYSTEM.md"
        tmp_system_prompt_file = task_dir / "log" / "prompt" / f"system_{timestamp}_{uuid.uuid4().hex[:8]}.md"
        tmp_system_prompt_file.parent.mkdir(parents=True, exist_ok=True)
        with open(tmp_system_prompt_file, "w", encoding="utf-8") as f:
            if add_system_prompt_file.exists():
                f.write(add_system_prompt_file.read_text(encoding="utf-8"))

        claude_env = MODEL_ENVS.get(model, {}).get("env", "")
        if not claude_env:
            logging.info(f"警告: 未找到模型 '{model}' 的环境变量配置，使用默认配置")
        else:
            logging.info(f"已加载模型 '{model}' 环境变量")

        tt = f"/tmp/prompt_{uuid.uuid4().hex[:8]}.md"
        with open(tt, "w", encoding="utf-8") as f:
            f.write(prompt)

        continue_str = "--continue " if continue_flag else ""
        cmd = (
            f"{claude_env} && echo {tt} | claude "
            f"{continue_str}"
            f"--append-system-prompt-file {tmp_system_prompt_file} "
            f"--permission-mode bypassPermissions --include-partial-messages "
            f"--debug-file {debug_file} --output-format stream-json --verbose -p"
        )

        logging.info(f"\n{'═' * 60}")
        logging.info(f"▶ Agent: {agent}  (Model: {model})")
        logging.info(f"  Debug: {debug_file}")
        logging.info(f"{'═' * 60}\n")
        print(cmd)
        try:
            process = subprocess.Popen(
                cmd, shell=True, stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT, text=True, bufsize=1,
            )
            start_time = time.time()
            timeout = 3000

            while True:
                ready, _, _ = select.select([process.stdout], [], [], 10)
                if ready:
                    line = process.stdout.readline()
                    if not line:
                        break
                    if "/bin/sh: 1: Test: not found\n" == line:
                        continue
                    print(line, end='', flush=True)
                    try:
                        data = json.loads(line)
                        msg = parser_msg(data)
                        if msg:
                            if "'type': 'image'" in str(msg):
                                continue
                            log(msg, task_dir)
                        if data.get("type") == "result" and data.get("subtype") == "success":
                            process.kill()
                            return True
                    except json.JSONDecodeError:
                        pass
                else:
                    if process.poll() is not None:
                        break
                    if time.time() - start_time > timeout:
                        process.kill()
                        logging.error(f"✗ Agent {agent} 命令执行超时 ({timeout}秒)")
                        break

            process.wait()
            logging.info(f"\n{'═' * 60}")
            if process.returncode != 0:
                logging.error(f"✗ Agent {agent} 执行失败, 返回码: {process.returncode}")
                continue
            logging.info(f"✓ Agent {agent} 完成, 返回码: {process.returncode}")
            return True
        except Exception as e:
            logging.error(f"✗ Agent {agent} 执行异常: {e}")
            continue

    logging.error(f"✗ Agent {agent} 重试 {max_retries} 次后仍失败")
    return False


def test_gateway(file_path, task_dir) -> bool:
    """验收闸：统计 - [ ] 数量，全 - [x] 才过"""
    file_path_obj = Path(file_path)
    search_path = file_path_obj if file_path_obj.is_absolute() else task_dir / file_path_obj
    if not search_path.exists():
        logging.warning(f"验收文档不存在: {search_path}")
        return False
    content = search_path.read_text(encoding="utf-8")
    incomplete = len(re.findall(r'^- \[ \]', content, re.MULTILINE))
    completed = len(re.findall(r'^- \[x\]', content, re.MULTILINE))
    logging.info(f"验收状态: 已完成={completed}, 未完成={incomplete}  ({search_path.name})")
    return incomplete == 0 and completed > 0


# ==================== xdd 全链节点定义 ====================
# 每个节点: (agent名, 产出文档, use skill, 默认模型)
# 产出文档含 - [ ] 自检清单，test_gateway 据此判通过
def build_nodes(task_dir):
    """构建 xdd 八节点。产出路径相对 task_dir。"""
    design = task_dir / ".xdd" / "design"
    runs = task_dir / ".xdd" / "runs" / "iter-1"
    return [
        ("brainstorm", design / "design.md",            "use skill: xdd-brainstorm",  DEFAULT_MODEL),
        ("spec",       design / "spec" / "rules.md",    "use skill: xdd-spec",        DEFAULT_MODEL),
        ("architecture", design / "architecture" / "architecture.md", "use skill: xdd-architecture", DEFAULT_MODEL),
        ("wire",       design / "wire" / "wire.md",     "use skill: xdd-wire",        DEFAULT_MODEL),
        ("resilience", design / "resilience.md",        "use skill: xdd-resilience",  DEFAULT_MODEL),
        ("plan",       runs / "plan" / "plan.md",       "use skill: xdd-plan",        "GLM"),
        ("execute",    runs / "implement.md",           "use skill: xdd-execute",     DEFAULT_MODEL),
        ("verify",     runs / "verify-report.md",       "use skill: xdd-verify",      "GLM"),
    ]


def node_prompt(node_name, skill_cmd, output_doc, task_dir, prd_md, extra=""):
    """生成单节点 prompt"""
    return f"""{skill_cmd}，不要问问题，自主选择最优方案。
任务目录: {task_dir}
需求文档: {prd_md}
{extra}
产出文档: {output_doc}（文档末尾必须含本节点的自检清单，用 - [ ] 标记各项，完成的改 - [x]）"""


def workflow(task_dir, model=DEFAULT_MODEL, force=False):
    task_dir = Path(task_dir)

    # 初始化 logging
    log_file = task_dir / "log" / "workflow.log"
    log_file.parent.mkdir(parents=True, exist_ok=True)
    file_handler = logging.FileHandler(log_file, encoding="utf-8")
    file_handler.setLevel(logging.INFO)
    file_handler.setFormatter(logging.Formatter("%(asctime)s - %(levelname)s - %(message)s"))
    logging.getLogger().addHandler(file_handler)

    prd_md = task_dir / "prd.md"
    if not prd_md.exists():
        logging.error(f"✗ 缺需求文档: {prd_md}")
        return

    nodes = build_nodes(task_dir)

    # === 第一阶段：设计层 + 桥接 + 代码层顺序执行 ===
    logging.info("=== 第一阶段：xdd 全链顺序执行 ===")
    for agent, doc, skill_cmd, node_model in nodes:
        if not force and doc.exists():
            logging.info(f"→ 跳过 {agent}（{doc.name} 已存在，加 -f 强制重跑）")
            continue
        # 各节点专属上下文（用 nodes 里已定义的路径，避免重复拼接）
        design_md = nodes[0][1]      # design.md
        spec_doc = nodes[1][1]       # spec rules.md
        plan_doc = nodes[5][1]       # plan.md
        extra = ""
        if agent == "spec":
            extra = f"上游: {design_md}"
        elif agent == "architecture":
            extra = f"上游: spec 规则({spec_doc}) + {design_md}"
        elif agent == "execute":
            extra = f"上游 plan: {plan_doc}"
        elif agent == "verify":
            extra = "对照 spec RXX + architecture 端点双契约验代码，4 维审计"

        prompt = node_prompt(agent, skill_cmd, doc, task_dir, prd_md, extra)
        ok = agent_worker(agent, prompt, task_dir, model=node_model)
        if not ok:
            logging.error(f"✗ 节点 {agent} 执行失败，workflow 中止")
            return

    # === 第二阶段：验收循环（verify 报告当闸，未过回 execute 重做）===
    logging.info("=== 第二阶段：验收循环 ===")
    num = 0
    while True:
        verify_doc = nodes[7][1]  # verify-report.md
        if test_gateway(verify_doc, task_dir):
            logging.info(f"\n✓ 第 {num} 轮验收通过（verify 自检清单全 - [x]）")
            break

        logging.warning(f"\n⚠ 第 {num} 轮验收未通过，回 execute 重新迭代")
        num += 1
        loop_dir = task_dir / f"loop_main_{num}"
        loop_dir.mkdir(parents=True, exist_ok=True)

        fix_plan = loop_dir / "fix_plan.md"
        fix_report = loop_dir / "implement.md"

        # 重新 plan（基于 verify 报告的未过项）
        plan_prompt = f"""use skill: xdd-plan; 不要问问题。验收未过，根据 verify 报告 {verify_doc} 的未过项重做计划。
需求: {prd_md}  规则: {nodes[1][1]}  上轮 verify: {verify_doc}
产出: {fix_plan}（含自检清单 - [ ]）"""
        agent_worker("plan-fix", plan_prompt, task_dir, model="GLM")

        # 重新 execute
        exec_prompt = f"""use skill: xdd-execute; 根据 {fix_plan} 修复未过项。
输出开发报告: {fix_report}（含自检清单 - [ ]）"""
        agent_worker("execute-fix", exec_prompt, task_dir, model=model)

        # 重跑 verify
        verify_prompt = f"""use skill: xdd-verify; 重新验收（**你是批判者，对不合理点质疑，谨防被忽悠**）。
对照 {prd_md} {nodes[1][1]} {nodes[2][1]} 验代码。
输出验收报告: {verify_doc}（自检清单 - [ ]，过的改 - [x]）"""
        agent_worker("verify-fix", verify_prompt, task_dir, model="GLM")

    logging.info("\n🎉 xdd workflow 全部完成，验收通过")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="xdd workflow 调度器（外部 Python 编排 xdd 全链）",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
    python workflow/run_workflow.py -t demo/my-project -m YACC
    python workflow/run_workflow.py -t demo/my-project -m YACC -f   # 强制重跑所有节点
""",
    )
    parser.add_argument("-t", "--task_dir", required=True,
                        help="项目目录路径（须含 prd.md）")
    model_keys = list(MODEL_ENVS.keys()) if MODEL_ENVS else None
    parser.add_argument("-m", "--model", default=DEFAULT_MODEL,
                        choices=model_keys,
                        help=f"使用的模型 (默认: {DEFAULT_MODEL})" +
                             ("" if model_keys else "（models.yaml 未配置，任意值）"))
    parser.add_argument("-f", "--force", action="store_true",
                        help="强制重跑所有节点（忽略已存在的产出）")
    args = parser.parse_args()
    workflow(args.task_dir, args.model, args.force)
